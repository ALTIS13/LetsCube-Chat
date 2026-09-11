import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import { stampServiceWorker } from "../../artifacts/kub/serviceWorkerBuildPlugin";
import { readServiceWorkerBuild, type ServiceWorkerBuild } from "../../artifacts/kub/src/lib/pwa/serviceWorkerBuild";

/**
 * The service worker, on a real build, with the worker ACTIVE.
 *
 * Every other spec that touches pictures runs with `serviceWorkers: "block"`,
 * so until this file the worker's own path had never been exercised in either
 * engine. It also used to be untestable in the way that mattered: its bytes
 * never changed, so a deploy never produced a new worker at all.
 *
 * Nothing here uses the dev server. The worker is only ever stamped by
 * `vite build`, and the dev server serves an unbuilt worker that deliberately
 * caches nothing, so a worker test against it would test a different program.
 * The spec builds the application once per source digest and serves three
 * deploys from it the way docs/deploy/nginx.conf does:
 *
 *  - `legacy`  — this build with the worker production served until now, pinned
 *                byte for byte (SHA-256 3e9303db…) in tests/fixtures;
 *  - `current` — this build as `vite build` emitted it;
 *  - `next`    — the same build with its entry renamed and the worker restamped,
 *                which is what the following deploy looks like to a browser.
 *
 * No backend is involved and nobody signs in: the guest home registers the
 * worker like every page, and the pictures come from a local server that
 * answers like the storage API with images generated here.
 */

const ENGINE_PROJECTS = ["chromium-mobile-390", "webkit-mobile-390"];
const APP_PORT = 5226;
const STORAGE_PORT = 5227;
const APP = `http://127.0.0.1:${APP_PORT}`;
const STORAGE = `http://127.0.0.1:${STORAGE_PORT}`;
const LEGACY_WORKER_SHA256 = "3e9303db3bfa43427c39fda2cabfc3cf4ca4fd65dd132eafac3ca420d3c48158";
const LEGACY = "legacy";
const UPDATE_BANNER_TEXT = "Доступно обновление";

// Public fixture values, the same ones the routing matrix uses. The page never
// reaches a backend; these only let the application boot.
const BUILD_ENV: Record<string, string> = {
  PORT: String(APP_PORT),
  BASE_PATH: "/",
  NODE_ENV: "production",
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "playwright-public-fixture",
};

type Deploys = {
  legacy: string;
  current: string;
  next: string;
  currentBuild: ServiceWorkerBuild;
  nextBuild: ServiceWorkerBuild;
};

let deploys: Deploys;
let app: FixtureServer;
let storage: FixtureServer;

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({}, testInfo) => {
  const names = testInfo.config.projects.map((project) => project.name);
  for (const required of ENGINE_PROJECTS) {
    if (!names.includes(required)) {
      throw new Error(`Playwright project "${required}" is not configured; this worker contract would skip unseen.`);
    }
  }
  test.skip(
    !ENGINE_PROJECTS.includes(testInfo.project.name),
    "The worker's behaviour depends on the engine, not the viewport; it runs once per engine.",
  );
  test.setTimeout(600_000);

  const root = path.dirname(testInfo.config.configFile ?? path.resolve("playwright.config.ts"));
  deploys = await prepareDeploys(root);
  app = await startServer(APP_PORT, appHandler(() => app.root));
  storage = await startServer(STORAGE_PORT, storageHandler);
});

test.afterAll(async () => {
  await app?.close();
  await storage?.close();
});

test("a first launch after a deploy is taken over by the new worker without a prompt or a reload, and the old cache is gone", async ({
  context,
}) => {
  await context.addInitScript(trackPage);
  app.root = deploys.legacy;
  const before = await context.newPage();
  await before.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await becomeControlled(before);
  expect(await probeController(before), "the legacy deploy must be served by the legacy worker").toBe(LEGACY);
  await seedDeadAssets(before);
  expect((await pageState(before)).cacheNames).toEqual(["kub-app-shell-v2"]);
  await before.close();

  app.root = deploys.current;
  const page = await context.newPage();
  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });

  await expect.poll(() => probeController(page), { timeout: 45_000 }).toBe(deploys.currentBuild.id);
  await expect.poll(async () => (await pageState(page)).cacheNames, { timeout: 15_000 }).toEqual([
    `kub-app-shell-${deploys.currentBuild.id}`,
  ]);
  const state = await pageState(page);
  expect(state.loads, "the page was reloaded to be taken over").toBe(1);
  expect(state.updateReadyEvents, "the page was asked to update to the build it already runs").toBe(0);
  expect(state.entry).toBe(deploys.currentBuild.entry);
  await expect(page.getByText(UPDATE_BANNER_TEXT)).toHaveCount(0);
});

test("a page on an older build is offered the update, and accepting reloads it exactly once onto the new worker", async ({
  context,
}) => {
  await context.addInitScript(trackPage);
  app.root = deploys.current;
  const page = await context.newPage();
  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await becomeControlled(page);
  await expect.poll(() => probeController(page), { timeout: 20_000 }).toBe(deploys.currentBuild.id);
  const loadsBefore = (await pageState(page)).loads;

  app.root = deploys.next;
  await page.evaluate(() => navigator.serviceWorker.getRegistration("/").then((registration) => registration?.update()));
  await expect.poll(async () => (await pageState(page)).waiting, { timeout: 45_000 }).toBe(true);
  const banner = page.getByText(UPDATE_BANNER_TEXT);
  await expect(banner).toBeVisible({ timeout: 20_000 });
  expect((await pageState(page)).updateReadyEvents).toBe(1);

  await page.getByRole("button", { name: "Обновить", exact: true }).first().click();
  await expect.poll(() => readLoads(page), { timeout: 20_000 }).toBe(loadsBefore + 1);
  await page.waitForLoadState("domcontentloaded");
  // Long enough for a reload loop to have shown itself more than once.
  await page.waitForTimeout(6000);

  const state = await pageState(page);
  expect(state.loads, "the update reloaded the page more than once").toBe(loadsBefore + 1);
  expect(state.entry).toBe(deploys.nextBuild.entry);
  expect(await probeController(page)).toBe(deploys.nextBuild.id);
  await expect.poll(async () => (await pageState(page)).cacheNames).toEqual([`kub-app-shell-${deploys.nextBuild.id}`]);
  await expect(banner).toHaveCount(0);
});

test("while a second window is open the new worker waits; once it closes, the remaining window is taken over without a prompt or a reload", async ({
  context,
}) => {
  await context.addInitScript(trackPage);
  app.root = deploys.legacy;
  const first = await context.newPage();
  await first.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await becomeControlled(first);
  // The first window checks for an update as it boots, and that check has to be
  // answered by the deploy the window booted from. Answered after the switch
  // below, it fetches the new worker while this is still the origin's only
  // window — a window already running that worker's build, since the legacy
  // deploy differs from the current one only in sw.js — and the worker is handed
  // over at once. That is the product doing its job, not the case under test,
  // and it decided this test by which request reached the server first:
  // measured on WebKit, the first window's /sw.js arrived before the second
  // window's /, and the second window found the new cache already the only one.
  await first.waitForFunction(
    () => (window as unknown as { __kubUpdateChecks: Promise<unknown>[] }).__kubUpdateChecks.length > 0,
    undefined,
    { timeout: 20_000 },
  );
  await first.evaluate(() =>
    Promise.all((window as unknown as { __kubUpdateChecks: Promise<unknown>[] }).__kubUpdateChecks).then(() => undefined),
  );

  app.root = deploys.current;
  const second = await context.newPage();
  await second.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await expect.poll(async () => (await pageState(second)).waiting, { timeout: 45_000 }).toBe(true);
  // Long enough for both pages to have asked, and re-asked, with the other
  // window still open. A worker still waiting is a worker nothing handed over to.
  await second.waitForTimeout(5000);

  const secondLoads = (await pageState(second)).loads;
  for (const page of [first, second]) {
    const state = await pageState(page);
    expect(state.updateReadyEvents, "a page already on the waiting build was prompted").toBe(0);
    expect(state.waiting, "the worker took over while another window could still need the old cache").toBe(true);
  }

  // The remaining window is still asking on its bounded schedule, so it is
  // handed the worker once the other one is gone — without being reloaded or
  // prompted, which is the point.
  await first.close();
  await expect.poll(() => probeController(second), { timeout: 30_000 }).toBe(deploys.currentBuild.id);
  const after = await pageState(second);
  expect(after.loads, "closing the other window reloaded this one").toBe(secondLoads);
  expect(after.updateReadyEvents, "closing the other window prompted this one").toBe(0);
});

test("pictures from the storage origin paint under an active worker, failed ones fail visibly, and none is kept", async ({
  context,
}) => {
  app.root = deploys.current;
  const page = await context.newPage();
  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await becomeControlled(page);
  expect(await probeController(page), "the pictures must be requested under the built worker").toBe(
    deploys.currentBuild.id,
  );

  const outcome = await page.evaluate(async (origin) => {
    const sources: Record<string, string> = {
      "photo-1": `${origin}/storage/v1/object/public/media/variants/messages/photo-1.png`,
      "photo-2": `${origin}/storage/v1/object/public/media/variants/messages/photo-2.png`,
      "photo-3": `${origin}/storage/v1/object/public/media/variants/messages/photo-3.png`,
      missing: `${origin}/storage/v1/object/public/media/missing/photo-4.png`,
      dropped: `${origin}/storage/v1/object/public/media/dropped/photo-5.png`,
    };
    // The shape `MediaImage` renders: a box reserved by aspect-ratio inside a
    // scroller, and a lazy, asynchronously decoded image filling it.
    const scroller = document.createElement("div");
    scroller.style.cssText = "position:fixed;inset:0;z-index:2147483647;overflow-y:auto;background:#fff";
    document.body.appendChild(scroller);
    const settle = (name: string, src: string) =>
      new Promise<[string, string]>((resolve) => {
        const box = document.createElement("button");
        box.style.cssText = "display:block;aspect-ratio:16/9;width:280px;padding:0;border:0;overflow:hidden";
        const image = document.createElement("img");
        image.loading = "lazy";
        image.decoding = "async";
        image.style.cssText = "display:block;width:100%;height:100%;object-fit:cover";
        const timer = setTimeout(() => resolve([name, "neither painted nor failed"]), 10_000);
        image.onload = () => {
          clearTimeout(timer);
          resolve([name, image.naturalWidth > 0 ? "painted" : "loaded with no pixels"]);
        };
        image.onerror = () => {
          clearTimeout(timer);
          resolve([name, "failed"]);
        };
        image.src = src;
        box.appendChild(image);
        scroller.appendChild(box);
      });
    const results = await Promise.all(Object.entries(sources).map(([name, src]) => settle(name, src)));
    scroller.remove();
    return Object.fromEntries(results);
  }, STORAGE);

  // A failure has to be an error the bubble can see: `MediaImage` falls back to
  // the original on `error`, and a picture that neither loads nor fails is the
  // reserved, empty rectangle from the owner's screenshot.
  expect(outcome).toEqual({
    "photo-1": "painted",
    "photo-2": "painted",
    "photo-3": "painted",
    missing: "failed",
    dropped: "failed",
  });

  const kept = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(kept.length, "the build's own files should be cached").toBeGreaterThan(0);
  expect(kept.filter((url) => !url.startsWith(`${APP}/`)), "the worker kept another origin's response").toEqual([]);
  expect(kept.filter((url) => url.includes("/storage/v1/")), "the worker kept a storage response").toEqual([]);
});

test("a build file the network cannot deliver fails as a network error, never as the offline page", async ({
  context,
}) => {
  app.root = deploys.current;
  const page = await context.newPage();
  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await becomeControlled(page);
  expect(await probeController(page)).toBe(deploys.currentBuild.id);
  expect(await readDroppedBuildFiles(page)).toEqual({
    script: "network error",
    icon: "network error",
    image: "failed",
  });
});

test("control: the worker production ran until now answered those same files with the offline page", async ({
  context,
}) => {
  // Without this, the case above could pass in an environment where fetch
  // events never reach a worker at all. The legacy worker is the fault itself.
  app.root = deploys.legacy;
  const page = await context.newPage();
  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await becomeControlled(page);
  expect(await probeController(page)).toBe(LEGACY);
  const outcome = await readDroppedBuildFiles(page);
  expect(outcome.script).toBe("answered 200 text/html");
  expect(outcome.icon).toBe("answered 200 text/html");
});

// ---------------------------------------------------------------- page helpers

/**
 * Runs in every page before its scripts: counts loads per tab and update
 * prompts, and keeps every update check the page starts, so a test can wait for
 * the checks a page has already made to be answered.
 */
function trackPage() {
  const loads = Number(sessionStorage.getItem("kub-e2e-loads") ?? "0") + 1;
  sessionStorage.setItem("kub-e2e-loads", String(loads));
  const tracked = window as unknown as { __kubUpdateReady: number; __kubUpdateChecks: Promise<unknown>[] };
  tracked.__kubUpdateReady = 0;
  tracked.__kubUpdateChecks = [];
  window.addEventListener("kub:sw-update-ready", () => {
    tracked.__kubUpdateReady += 1;
  });
  if (typeof ServiceWorkerRegistration === "undefined") return;
  const update = ServiceWorkerRegistration.prototype.update;
  ServiceWorkerRegistration.prototype.update = function (this: ServiceWorkerRegistration) {
    const check = update.call(this);
    tracked.__kubUpdateChecks.push(check.catch(() => undefined));
    return check;
  };
}

async function becomeControlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 20_000 });
}

/**
 * The controlling worker's build, asked through the handoff message with an
 * entry no build has — so asking can never make anything take over. The legacy
 * worker does not know the message and stays silent.
 */
async function probeController(page: Page): Promise<string> {
  return page
    .evaluate(async () => {
      const worker = navigator.serviceWorker.controller;
      if (!worker) return "none";
      return await new Promise<string>((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve("legacy"), 1500);
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          resolve(typeof event.data?.build === "string" ? event.data.build : "unknown");
        };
        worker.postMessage({ type: "KUB_SW_HANDOFF", entry: "/assets/__probe__.js" }, [channel.port2]);
      });
    })
    .catch(() => "unavailable");
}

async function pageState(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return {
      loads: Number(sessionStorage.getItem("kub-e2e-loads")),
      updateReadyEvents: (window as unknown as { __kubUpdateReady: number }).__kubUpdateReady,
      entry: document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? null,
      waiting: Boolean(registration?.waiting),
      cacheNames: (await caches.keys()).sort(),
    };
  });
}

async function readLoads(page: Page): Promise<number> {
  return page.evaluate(() => Number(sessionStorage.getItem("kub-e2e-loads"))).catch(() => -1);
}

/** What production's legacy cache looked like: previous deploys' assets nobody deleted. */
async function seedDeadAssets(page: Page) {
  await page.evaluate(async () => {
    const cache = await caches.open("kub-app-shell-v2");
    for (let index = 0; index < 3; index += 1) {
      await cache.put(
        new Request(`/assets/index-DEAD${index}.js`),
        new Response("export {}", { headers: { "content-type": "application/javascript" } }),
      );
    }
  });
}

async function readDroppedBuildFiles(page: Page) {
  return page.evaluate(async () => {
    const probe = async (target: string) => {
      try {
        const response = await fetch(target);
        return `answered ${response.status} ${(response.headers.get("content-type") ?? "").split(";")[0]}`;
      } catch {
        return "network error";
      }
    };
    const image = await new Promise<string>((resolve) => {
      const picture = new Image();
      const timer = setTimeout(() => resolve("neither painted nor failed"), 10_000);
      picture.onload = () => {
        clearTimeout(timer);
        resolve("loaded");
      };
      picture.onerror = () => {
        clearTimeout(timer);
        resolve("failed");
      };
      picture.src = "/icons/__drop__-picture.png";
    });
    return {
      script: await probe("/assets/__drop__-chunk.js"),
      icon: await probe("/icons/__drop__-icon.png"),
      image,
    };
  });
}

// ---------------------------------------------------------------- build and deploys

async function prepareDeploys(root: string): Promise<Deploys> {
  const kub = path.join(root, "artifacts", "kub");
  const work = path.join(root, "output", "pwa-service-worker");
  const current = path.join(work, "current");
  const legacy = path.join(work, "legacy");
  const next = path.join(work, "next");

  const legacyWorker = readFileSync(path.join(root, "tests", "fixtures", "legacy-service-worker-v2.js"), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const legacyDigest = createHash("sha256").update(legacyWorker).digest("hex");
  if (legacyDigest !== LEGACY_WORKER_SHA256) {
    throw new Error(`tests/fixtures/legacy-service-worker-v2.js is not the worker production served (${legacyDigest}).`);
  }

  const digest = sourceDigest(kub);
  const digestFile = path.join(work, "current.digest");
  const reusable =
    existsSync(digestFile) && readFileSync(digestFile, "utf8") === digest && existsSync(path.join(current, "sw.js"));
  if (!reusable) {
    mkdirSync(work, { recursive: true });
    await buildApplication(kub, current);
    writeFileSync(digestFile, digest);
  }

  const currentBuild = readServiceWorkerBuild(readFileSync(path.join(current, "sw.js"), "utf8"));
  if (!currentBuild || !/^[0-9a-f]{16}$/.test(currentBuild.id) || !currentBuild.entry) {
    throw new Error(
      "The built sw.js carries no build record. Is the kub-service-worker-build plugin still in vite.config.ts?",
    );
  }

  rmSync(legacy, { recursive: true, force: true });
  cpSync(current, legacy, { recursive: true });
  writeFileSync(path.join(legacy, "sw.js"), legacyWorker);

  rmSync(next, { recursive: true, force: true });
  cpSync(current, next, { recursive: true });
  const entryName = path.posix.basename(currentBuild.entry);
  const nextName = entryName.replace(/\.js$/, "-next.js");
  for (const file of listFiles(next)) {
    if (!/\.(js|css|html)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes(entryName)) writeFileSync(file, text.split(entryName).join(nextName));
  }
  renameSync(path.join(next, "assets", entryName), path.join(next, "assets", nextName));
  await stampServiceWorker(next);
  const nextBuild = readServiceWorkerBuild(readFileSync(path.join(next, "sw.js"), "utf8"));
  if (!nextBuild || nextBuild.entry !== `/assets/${nextName}` || nextBuild.id === currentBuild.id) {
    throw new Error("The next deploy was not restamped with its own build.");
  }

  return { legacy, current, next, currentBuild, nextBuild };
}

function sourceDigest(kub: string): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(BUILD_ENV));
  const visit = (target: string) => {
    if (statSync(target).isDirectory()) {
      for (const name of readdirSync(target).sort()) visit(path.join(target, name));
      return;
    }
    hash.update(path.relative(kub, target).split(path.sep).join("/"));
    hash.update(readFileSync(target));
  };
  for (const entry of ["src", "public", "index.html", "vite.config.ts", "serviceWorkerBuildPlugin.ts", "package.json"]) {
    visit(path.join(kub, entry));
  }
  return hash.digest("hex");
}

async function buildApplication(kub: string, outDir: string) {
  const viteBin = path.join(kub, "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(viteBin)) throw new Error(`Vite is not installed for @workspace/kub at ${viteBin}.`);
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (existsSync(path.join(kub, name))) {
      throw new Error(`${path.join(kub, name)} would replace this spec's fixture configuration; remove it first.`);
    }
  }
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^VITE_/i.test(key)) env[key] = value;
  }
  Object.assign(env, BUILD_ENV);

  const child = spawn(
    process.execPath,
    [viteBin, "build", "--config", "vite.config.ts", "--outDir", outDir, "--emptyOutDir"],
    { cwd: kub, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const transcript: string[] = [];
  const record = (chunk: unknown) => {
    transcript.push(String(chunk));
    if (transcript.length > 400) transcript.shift();
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`vite build exited with ${code}.\n${transcript.join("")}`);
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

// ---------------------------------------------------------------- servers

type FixtureServer = { root: string; close: () => Promise<void> };

async function startServer(port: number, handler: http.RequestListener): Promise<FixtureServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(`Port ${port} is already in use. This spec owns it; stop the other server first.`)
          : error,
      );
    });
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    root: "",
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
};

/** Answers the way docs/deploy/nginx.conf does, for whichever deploy is current. */
function appHandler(root: () => string): http.RequestListener {
  return (request, response) => {
    const uri = new URL(request.url ?? "/", APP).pathname;
    // A connection that drops before any answer: a lost network, as a fetch sees it.
    if (uri.includes("__drop__")) {
      request.socket.destroy();
      return;
    }
    const base = root();
    const resolved = path.resolve(base, `.${decodeURIComponent(uri)}`);
    const inside = resolved.startsWith(base) && existsSync(resolved) && statSync(resolved).isFile();
    if (!inside && uri.startsWith("/assets/")) {
      response.writeHead(404, { "Content-Type": "text/html" }).end("<html>404</html>");
      return;
    }
    const file = inside ? resolved : path.join(base, "index.html");
    const served = inside ? uri : "/index.html";
    const headers: Record<string, string> = {
      "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    };
    if (served === "/sw.js") headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    else if (served.startsWith("/assets/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
    else if (served === "/index.html") headers["Cache-Control"] = "no-cache";
    else if (served === "/manifest.json") headers["Cache-Control"] = "public, max-age=300";
    response.writeHead(200, headers);
    createReadStream(file).pipe(response);
  };
}

/** A storage origin: synthetic pictures, a missing object, and a dropped connection. */
const storageHandler: http.RequestListener = (request, response) => {
  const uri = new URL(request.url ?? "/", STORAGE).pathname;
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  if (/^\/storage\/v1\/object\/public\/media\/variants\/messages\/[\w-]+\.png$/.test(uri)) {
    response.writeHead(200, { ...headers, "Content-Type": "image/png" }).end(PICTURE);
    return;
  }
  if (uri.startsWith("/storage/v1/object/public/media/dropped/")) {
    request.socket.destroy();
    return;
  }
  response.writeHead(404, { ...headers, "Content-Type": "application/json" }).end('{"error":"not_found"}');
};

/** A 320x180 PNG of one colour, generated here so no real picture is ever involved. */
const PICTURE = (() => {
  const width = 320;
  const height = 180;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([40, 120, 200], 1 + x * 3);
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
})();
