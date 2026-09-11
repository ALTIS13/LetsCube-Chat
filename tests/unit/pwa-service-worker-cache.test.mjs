import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { UNBUILT_SERVICE_WORKER, renderServiceWorker } from "../../artifacts/kub/src/lib/pwa/serviceWorkerBuild.ts";

/**
 * What the service worker keeps, what it answers, and what it deletes.
 *
 * Three faults found in `sw.js`, each pinned here against the real worker file
 * running in a vm with a Cache Storage and a network that answer the way the
 * browser and docs/deploy/nginx.conf do:
 *
 *   1. its cache name was a constant, so no deploy ever replaced the worker and
 *      `activate` never deleted anything;
 *   2. on a network failure with nothing cached it answered EVERY request with
 *      offline.html — scripts, stylesheets and images included;
 *   3. it kept the backend out of its cache with `hostname.endsWith(".supabase.co")`,
 *      a host production does not use, and only the origin check below it did
 *      the work.
 */

const ORIGIN = "https://app.letscube.ru";
const BACKEND = "https://core.letscube.ru";
const ENTRY = "/assets/index-NEW111.js";
const STYLE = "/assets/index-NEW111.css";
const BUILT = { id: "a1b2c3d4e5f60718", entry: ENTRY, precache: [ENTRY, STYLE] };
const OFFLINE_TEXT = "Нет подключения";

const template = await readFile(new URL("../../artifacts/kub/public/sw.js", import.meta.url), "utf8");
const absolute = (input) => new URL(typeof input === "string" ? input : input.url, ORIGIN).href;

const document = (body) =>
  new Response(`<!doctype html>${body}`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const file = (body, type, init = {}) =>
  new Response(body, { status: 200, ...init, headers: { "content-type": type, ...(init.headers ?? {}) } });

/** The files one deploy serves, by path. */
function deployRoutes(entry = ENTRY, style = STYLE) {
  return {
    "/": document(`<script type="module" crossorigin src="${entry}"></script>`),
    "/index.html": document(`<script type="module" crossorigin src="${entry}"></script>`),
    "/manifest.json": file("{}", "application/json"),
    "/offline.html": document(`<p>${OFFLINE_TEXT}</p>`),
    "/favicon.svg": file("<svg/>", "image/svg+xml"),
    "/icons/apple-touch-icon.png": file("png", "image/png"),
    "/icons/icon-192.png": file("png", "image/png"),
    "/icons/icon-512.png": file("png", "image/png"),
    "/icons/icon-maskable-512.png": file("png", "image/png"),
    [entry]: file("export {}", "application/javascript"),
    [style]: file("body{}", "text/css"),
  };
}

function createNetwork(routes) {
  const network = {
    routes,
    online: true,
    log: [],
    async fetch(input) {
      const url = absolute(input);
      network.log.push(url);
      if (!network.online) throw new TypeError("Failed to fetch");
      const route = network.routes[url] ?? network.routes[new URL(url).pathname];
      if (typeof route === "function") return route(input);
      if (route) return route.clone();
      // nginx: `location /assets/` has no fallback; everything else falls back to index.html.
      if (new URL(url).pathname.startsWith("/assets/")) {
        return new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } });
      }
      return network.routes["/"].clone();
    },
  };
  return network;
}

function createCacheStorage(network) {
  const stores = new Map();
  const storage = {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(input) {
          return entries.get(absolute(input))?.clone();
        },
        async put(input, response) {
          if (response.status === 206) throw new TypeError("Partial response (status code 206) is unsupported");
          entries.set(absolute(input), response.clone());
        },
        async addAll(inputs) {
          const fetched = [];
          for (const input of inputs) {
            const response = await network.fetch(input);
            if (!response.ok) throw new TypeError(`addAll: ${absolute(input)} answered ${response.status}`);
            fetched.push([absolute(input), response]);
          }
          for (const [url, response] of fetched) entries.set(url, response);
        },
        async keys() {
          return [...entries.keys()];
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    entries(name) {
      return [...(stores.get(name)?.keys() ?? [])].map((url) => new URL(url).pathname);
    },
  };
  return storage;
}

class WorkerRequest extends Request {
  constructor(input, init) {
    super(typeof input === "string" ? new URL(input, ORIGIN).href : input, init);
  }
}

function loadWorker({ build = BUILT, network = createNetwork(deployRoutes()), storage, windows = [] } = {}) {
  const listeners = new Map();
  const state = { skipWaitingCalls: 0 };
  const caches = storage ?? createCacheStorage(network);
  const context = {
    URL,
    Headers,
    Response,
    Request: WorkerRequest,
    caches,
    fetch: (input) => network.fetch(input),
    self: {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      location: { origin: ORIGIN },
      registration: { async getNotifications() { return []; }, async showNotification() {} },
      clients: { async matchAll() { return windows; } },
      async skipWaiting() {
        state.skipWaitingCalls += 1;
      },
    },
  };
  const source = build === UNBUILT_SERVICE_WORKER ? template : renderServiceWorker(template, build);
  vm.runInNewContext(source, context, { filename: "sw.js" });
  return { listeners, caches, network, state, cacheName: `kub-app-shell-${build.id}` };
}

async function lifecycle(worker, type) {
  const pending = [];
  worker.listeners.get(type)({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
}

function request(path, { mode = "no-cors", method = "GET", headers = {}, cache = "default" } = {}) {
  return { url: new URL(path, ORIGIN).href, mode, method, headers: new Headers(headers), cache };
}

/** Dispatches a fetch event; `handled: false` means the browser goes to the network itself. */
async function dispatchFetch(worker, fetchRequest) {
  let responded = null;
  const pending = [];
  worker.listeners.get("fetch")({
    request: fetchRequest,
    respondWith: (value) => {
      responded = Promise.resolve(value);
    },
    waitUntil: (promise) => pending.push(promise),
  });
  if (!responded) return { handled: false };
  const response = await responded;
  await Promise.all(pending);
  return { handled: true, response };
}

async function installed(options) {
  const worker = loadWorker(options);
  await lifecycle(worker, "install");
  return worker;
}

// ---------------------------------------------------------------- lifecycle

test("a built worker's cache is named by its build and holds the shell and what it boots", async () => {
  const worker = await installed();
  assert.deepEqual(await worker.caches.keys(), [`kub-app-shell-${BUILT.id}`]);
  const kept = worker.caches.entries(worker.cacheName);
  for (const path of ["/", "/offline.html", "/manifest.json", "/icons/icon-192.png", ENTRY, STYLE]) {
    assert.ok(kept.includes(path), `install did not cache ${path}`);
  }
});

test("the next build's worker deletes every other cache on activate, the legacy one included", async () => {
  const network = createNetwork(deployRoutes());
  const storage = createCacheStorage(network);
  const legacy = await storage.open("kub-app-shell-v2");
  await legacy.put(`${ORIGIN}/assets/index-OLD000.js`, file("old", "application/javascript"));
  const previous = await storage.open("kub-app-shell-0000000000000000");
  await previous.put(`${ORIGIN}/assets/index-PREV00.js`, file("prev", "application/javascript"));

  const worker = loadWorker({ network, storage });
  await lifecycle(worker, "install");
  assert.equal((await storage.keys()).length, 3, "install must not delete anything: an older worker still serves");
  await lifecycle(worker, "activate");
  assert.deepEqual(await storage.keys(), [`kub-app-shell-${BUILT.id}`]);
});

test("an install whose shell document is another build's fails and keeps nothing", async () => {
  const routes = deployRoutes();
  routes["/"] = document(`<script type="module" src="/assets/index-OTHER9.js"></script>`);
  const worker = loadWorker({ network: createNetwork(routes) });
  await assert.rejects(lifecycle(worker, "install"), /different build/);
  assert.deepEqual(await worker.caches.keys(), []);
});

test("the unbuilt worker the dev server serves installs without a build to check", async () => {
  const routes = deployRoutes();
  routes["/"] = document(`<script type="module" src="/src/main.tsx"></script>`);
  const worker = loadWorker({ build: UNBUILT_SERVICE_WORKER, network: createNetwork(routes) });
  await lifecycle(worker, "install");
  assert.deepEqual(await worker.caches.keys(), ["kub-app-shell-dev"]);
});

// ---------------------------------------------------------------- what is answered

test("nothing on another origin is answered, whatever the backend's host is called", async () => {
  const worker = await installed();
  const before = worker.network.log.length;
  for (const [url, mode] of [
    [`${BACKEND}/storage/v1/object/public/media/variants/messages/a.webp`, "no-cors"],
    [`${BACKEND}/storage/v1/object/sign/media/a.png?token=x`, "no-cors"],
    [`${BACKEND}/rest/v1/messages?select=*`, "cors"],
    [`${BACKEND}/auth/v1/token?grant_type=refresh_token`, "cors"],
    [`${BACKEND}/realtime/v1/websocket`, "cors"],
    [`${BACKEND}/functions/v1/phone-verification-gateway`, "cors"],
    ["https://project.supabase.co/storage/v1/object/public/media/a.png", "no-cors"],
    ["https://api.letscube.ru/releases/stable.json", "cors"],
    ["https://fonts.googleapis.com/css2?family=Inter", "no-cors"],
    // Paths shaped exactly like this build's own files, on other origins: only
    // the origin tells them apart, so only the origin check can keep them out.
    [`${BACKEND}${ENTRY}`, "cors"],
    ["https://cdn.example/icons/icon-192.png", "no-cors"],
    ["https://cdn.example/manifest.json", "cors"],
  ]) {
    const result = await dispatchFetch(worker, request(url, { mode }));
    assert.equal(result.handled, false, `the worker answered ${url}`);
  }
  assert.equal(worker.network.log.length, before, "the worker fetched something on another origin itself");
  assert.deepEqual(worker.caches.entries(worker.cacheName).filter((path) => path.includes("/v1/")), []);
});

test("backend paths proxied onto this origin are not build files and are not answered", async () => {
  const worker = await installed();
  for (const path of [
    "/rest/v1/messages?select=*",
    "/auth/v1/token?grant_type=password",
    "/storage/v1/object/public/media/a.png",
    "/realtime/v1/websocket",
    "/functions/v1/send-push-notifications",
  ]) {
    const result = await dispatchFetch(worker, request(path, { mode: "cors" }));
    assert.equal(result.handled, false, `the worker answered ${path}`);
  }
});

test("a build file is kept once fetched and then served without another trip", async () => {
  const worker = await installed();
  worker.network.routes["/assets/chat-lazy.js"] = file("export const lazy = 1", "application/javascript");

  const first = await dispatchFetch(worker, request("/assets/chat-lazy.js", { mode: "cors" }));
  assert.equal(first.handled, true);
  assert.equal(await first.response.text(), "export const lazy = 1");
  const trips = worker.network.log.filter((url) => url.endsWith("/assets/chat-lazy.js")).length;

  const second = await dispatchFetch(worker, request("/assets/chat-lazy.js", { mode: "cors" }));
  assert.equal(await second.response.text(), "export const lazy = 1");
  assert.equal(worker.network.log.filter((url) => url.endsWith("/assets/chat-lazy.js")).length, trips);
});

test("offline with nothing cached, a script, a stylesheet or an image fails; none gets offline.html", async () => {
  const worker = await installed();
  worker.network.online = false;
  for (const path of ["/assets/chat-lazy.js", "/assets/settings-lazy.css", "/icons/never-cached.png"]) {
    const result = await dispatchFetch(worker, request(path));
    assert.equal(result.handled, true);
    assert.equal(result.response.type, "error", `${path} was answered with a ${result.response.status}`);
    assert.equal(result.response.status, 0);
  }
});

test("a navigation offline gets this build's shell, and without one the offline page", async () => {
  const worker = await installed();
  worker.network.online = false;
  const shell = await dispatchFetch(worker, request("/?chat=1", { mode: "navigate" }));
  assert.match(await shell.response.text(), new RegExp(ENTRY));

  worker.caches.stores.get(worker.cacheName).delete(`${ORIGIN}/`);
  const fallback = await dispatchFetch(worker, request("/tasks", { mode: "navigate" }));
  assert.match(await fallback.response.text(), new RegExp(OFFLINE_TEXT));
});

test("a navigation online is the network's answer and leaves this build's shell alone", async () => {
  const worker = await installed();
  worker.network.routes["/"] = document(`<script type="module" src="/assets/index-NEWER2.js"></script>`);
  const online = await dispatchFetch(worker, request("/", { mode: "navigate" }));
  assert.match(await online.response.text(), /index-NEWER2/);

  const kept = await (await worker.caches.open(worker.cacheName)).match("/");
  assert.match(await kept.text(), new RegExp(ENTRY), "a navigation overwrote the shell the build's files belong to");
});

test("only a complete, first-hand, successful answer is kept", async () => {
  const worker = await installed();
  const redirected = file("moved", "application/javascript");
  Object.defineProperty(redirected, "redirected", { value: true });
  Object.assign(worker.network.routes, {
    "/assets/partial.js": file("exp", "application/javascript", { status: 206, headers: { "content-range": "bytes 0-2/9" } }),
    "/assets/broken.js": file("oops", "application/javascript", { status: 500 }),
    "/assets/redirected.js": () => redirected,
    // nginx's SPA fallback: a missing icon is answered with index.html and a 200.
    "/icons/missing.png": document("<div id=root></div>"),
  });
  for (const path of ["/assets/partial.js", "/assets/broken.js", "/assets/redirected.js", "/icons/missing.png", "/assets/gone.js"]) {
    const result = await dispatchFetch(worker, request(path));
    assert.equal(result.handled, true);
    assert.ok(!worker.caches.entries(worker.cacheName).includes(path), `${path} was kept`);
  }
});

test("a range request and a request that bypasses caches go to the network", async () => {
  const worker = await installed();
  assert.equal((await dispatchFetch(worker, request(ENTRY, { headers: { range: "bytes=0-1" } }))).handled, false);
  assert.equal((await dispatchFetch(worker, request(ENTRY, { cache: "no-store" }))).handled, false);
  assert.equal((await dispatchFetch(worker, request(ENTRY, { cache: "reload" }))).handled, false);
  assert.equal((await dispatchFetch(worker, request(ENTRY, { method: "POST" }))).handled, false);
});

test("the unbuilt worker caches no file and falls back to the offline page", async () => {
  const worker = await installed({ build: UNBUILT_SERVICE_WORKER });
  assert.equal((await dispatchFetch(worker, request("/icons/icon-192.png"))).handled, false);
  worker.network.online = false;
  const fallback = await dispatchFetch(worker, request("/", { mode: "navigate" }));
  assert.match(await fallback.response.text(), new RegExp(OFFLINE_TEXT));
});

// ---------------------------------------------------------------- handoff

async function handoff(worker, { entry, source = "page-1", withPort = true } = {}) {
  const replies = [];
  const pending = [];
  worker.listeners.get("message")({
    data: { type: "KUB_SW_HANDOFF", entry },
    source: { id: source },
    ports: withPort ? [{ postMessage: (value) => replies.push(value) }] : [],
    waitUntil: (promise) => pending.push(promise),
  });
  await Promise.all(pending);
  return replies[0];
}

test("a page running this build, alone, is handed the worker at once", async () => {
  const worker = loadWorker({ windows: [{ id: "page-1" }] });
  // Copied out of the vm's realm: its objects carry the vm's Object.prototype,
  // which strict deep equality rightly refuses to call equal to this realm's.
  assert.deepEqual({ ...(await handoff(worker, { entry: ENTRY })) }, {
    type: "KUB_SW_HANDOFF_RESULT",
    build: BUILT.id,
    current: true,
    activated: true,
  });
  assert.equal(worker.state.skipWaitingCalls, 1);
});

test("with a second window open the worker keeps waiting", async () => {
  const worker = loadWorker({ windows: [{ id: "page-1" }, { id: "page-2" }] });
  const reply = await handoff(worker, { entry: ENTRY });
  assert.equal(reply.current, true);
  assert.equal(reply.activated, false);
  assert.equal(worker.state.skipWaitingCalls, 0);
});

test("the only window has to be the one asking", async () => {
  const worker = loadWorker({ windows: [{ id: "page-2" }] });
  const reply = await handoff(worker, { entry: ENTRY, source: "page-1" });
  assert.equal(reply.activated, false);
  assert.equal(worker.state.skipWaitingCalls, 0);
});

test("a page on another build is not this build, and nothing takes over", async () => {
  const worker = loadWorker({ windows: [{ id: "page-1" }] });
  const reply = await handoff(worker, { entry: "/assets/index-OLD000.js" });
  assert.deepEqual([reply.current, reply.activated], [false, false]);
  assert.equal(worker.state.skipWaitingCalls, 0);
});

test("the unbuilt worker never claims a page as its build", async () => {
  const worker = loadWorker({ build: UNBUILT_SERVICE_WORKER, windows: [{ id: "page-1" }] });
  const reply = await handoff(worker, { entry: "/src/main.tsx" });
  assert.deepEqual([reply.current, reply.activated], [false, false]);
  assert.equal(await handoff(worker, { entry: undefined, withPort: false }), undefined);
});
