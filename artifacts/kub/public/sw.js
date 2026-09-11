// LETSCUBE service worker.
//
// It exists for three things, in this order: push notifications and what a
// click on one opens; an offline shell for navigations; and a cache of this
// build's own static files, so that shell can boot without a network. It is not
// a network layer for anything else, and it answers nothing that is not this
// origin's own build.

// The build record. `vite build` rewrites this one line with a digest of every
// file it emits (artifacts/kub/serviceWorkerBuildPlugin.ts). That is what makes
// each deploy's worker differ by at least one byte — the only thing that makes a
// browser install it — and installing it is the only thing that runs `activate`,
// the only code that deletes the previous build's cache. The cache name used to
// be the constant `kub-app-shell-v2`, unchanged for 429 commits, so none of that
// happened and every deploy's assets stayed in Cache Storage.
//
// The dev server serves this line as written. An unbuilt worker has no build
// whose files it could cache, and caches none.
const BUILD = {"id":"dev","entry":null,"precache":[]}; // @kub-sw-build
const CACHE_NAME = `kub-app-shell-${BUILD.id}`;
const CACHES_BUILD_FILES = BUILD.id !== "dev";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/offline.html",
  "/favicon.svg",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];
const APP_NAME = "LETSCUBE";
const DEFAULT_PUSH_BODY = "Новое уведомление";

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
});

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  // The shell documents are fetched past the HTTP cache. The build's hashed
  // files are immutable, so whatever copy the HTTP cache already holds is the
  // right one and costs no second download.
  await cache.addAll([...APP_SHELL.map((url) => new Request(url, { cache: "reload" })), ...BUILD.precache]);
  if (!BUILD.entry) return;

  const shell = await cache.match("/");
  const html = shell ? await shell.text() : "";
  if (!html.includes(BUILD.entry)) {
    // `/` came from a different build than this worker: a deploy landed between
    // the two requests, or two replicas are serving different releases. A shell
    // assembled from two builds boots neither, so the install fails and the
    // browser tries again with whatever it fetches next.
    await caches.delete(CACHE_NAME);
    throw new Error("The shell document belongs to a different build than this worker.");
  }
}

self.addEventListener("activate", (event) => {
  // Every cache but this build's, `kub-app-shell-v2` included. The application
  // keeps nothing else in Cache Storage, so nothing else can be lost here.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "KUB_SKIP_WAITING") {
    const update = self.skipWaiting();
    if (typeof event.waitUntil === "function") event.waitUntil(update);
    return;
  }
  if (event.data?.type === "KUB_SW_HANDOFF") {
    const answered = answerHandoff(event);
    if (typeof event.waitUntil === "function") event.waitUntil(answered);
    return;
  }
  if (event.data?.type === "KUB_CLOSE_NOTIFICATION") {
    const tag = safeText(event.data?.tag, "", 120);
    if (!tag) return;
    const closeMatching = self.registration.getNotifications({ tag }).then((notifications) => {
      notifications.forEach((notification) => notification.close());
    });
    if (typeof event.waitUntil === "function") event.waitUntil(closeMatching);
  }
});

// A page that found this worker waiting names the build it booted (see
// artifacts/kub/src/lib/pwa/serviceWorkerHandoff.ts). When that is this worker's
// build and the page is this origin's only window, the worker takes over at
// once: no other window can still need the previous build's cache, and the page
// already runs this build, so nothing has to reload. Otherwise the worker keeps
// waiting, and only a page that is not this build goes on to offer an update.
async function answerHandoff(event) {
  const port = event.ports && event.ports[0];
  const current = Boolean(BUILD.entry) && event.data.entry === BUILD.entry;
  let activated = false;
  if (current) {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const askingId = event.source && event.source.id;
    if (askingId && windows.length === 1 && windows[0].id === askingId) {
      await self.skipWaiting();
      activated = true;
    }
  }
  if (port) port.postMessage({ type: "KUB_SW_HANDOFF_RESULT", build: BUILD.id, current, activated });
}

self.addEventListener("pushsubscriptionchange", (event) => {
  const notifyClients = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      clients.forEach((client) => client.postMessage({ type: "KUB_PUSH_SUBSCRIPTION_CHANGED" }));
    });
  event.waitUntil(notifyClients);
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  // Only this origin's own build is ever answered from here. Everything else —
  // the backend's REST, auth, realtime and storage wherever they are hosted, the
  // font host, anything on another origin — goes to the network untouched,
  // exactly as it would with no worker at all.
  //
  // This is deliberately not a list of backend hosts to stay away from. That
  // list was one entry, `.supabase.co`, which production stopped using when the
  // backend moved to its own domain: the check matched nothing, and only the
  // origin test kept storage out of the cache. A list of hosts to avoid is right
  // until the next host. A list of what to serve cannot drift that way, and it
  // keeps a backend proxied onto this origin out too, since none of its paths is
  // a build file.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (!CACHES_BUILD_FILES || !isBuildFile(url)) return;
  // A range request wants part of a file. A cached whole file is not an answer
  // to it, and a media element treats one as a broken stream.
  if (request.headers.has("range")) return;
  // A caller that asked to bypass caches gets the network, not this cache.
  if (request.cache === "no-store" || request.cache === "reload") return;

  event.respondWith(cacheFirst(event, request));
});

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    // A built worker's `/` is complete: the document and the files it boots were
    // cached together at install, from one build. The dev server's `/` is not,
    // so an unbuilt worker goes straight to the offline page.
    const shell = BUILD.entry ? await cache.match("/") : undefined;
    return shell || (await cache.match("/offline.html")) || Response.error();
  }
}

async function cacheFirst(event, request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  let response;
  try {
    response = await fetch(request);
  } catch {
    // Offline and not cached: fail the request the way the network would have.
    // This used to answer with offline.html, handing an HTML page to a script,
    // a stylesheet or an image — none of which can use one.
    return Response.error();
  }

  if (isStorable(request, response)) {
    const stored = cache.put(request, response.clone()).catch(() => {});
    try {
      event.waitUntil(stored);
    } catch {
      // The response is still pending, which keeps the worker alive for the write.
    }
  }
  return response;
}

// Only a complete, first-hand, successful answer is kept. A 206 is part of a
// file; an opaque or error answer has status 0; a redirect is another URL's
// answer. HTML is refused for everything but offline.html, because nginx answers
// a missing /icons/ file with index.html and a 200 (the SPA fallback), and
// stored, that page would be the icon for the rest of the build.
function isStorable(request, response) {
  if (response.status !== 200 || response.redirected) return false;
  const type = response.headers.get("content-type") || "";
  return !type.includes("text/html") || new URL(request.url).pathname === "/offline.html";
}

function isBuildFile(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/favicon.svg" ||
    url.pathname === "/offline.html"
  );
}

self.addEventListener("push", (event) => {
  let raw = {};
  try {
    raw = event.data ? event.data.json() : {};
  } catch {
    raw = { body: event.data ? event.data.text() : "" };
  }

  const data = normalizePushPayload(raw);

  event.waitUntil(showPushNotification(data));
});

async function showPushNotification(data) {
  await closePushNotificationTag(data.tag);
  return self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    renotify: data.renotify,
    timestamp: data.timestamp,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      url: data.url,
      kind: data.kind,
      tag: data.tag,
      chatId: data.chatId,
      messageId: data.messageId,
    },
  });
}

async function closePushNotificationTag(tag) {
  const existing = await self.registration.getNotifications({ tag });
  existing.forEach((notification) => notification.close());
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = ensureRelativeUrl(event.notification.data?.url || "/");

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if (client.url.includes(self.location.origin)) {
        client.focus();
        client.postMessage({ type: "kub-open", url: targetUrl });
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(new URL(targetUrl, self.location.origin).href);
    }
  })());
});

function normalizePushPayload(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const proposed = data.notification && typeof data.notification === "object" ? data.notification : {};
  const chatId = safeId(data.chatId || data.chat_id);
  const messageId = safeId(data.messageId || data.message_id);
  const taskId = safeId(data.taskId || data.task_id);
  const inviteId = safeId(data.inviteId || data.invite_id);
  const kind = safeText(data.kind, "notification", 60);
  const isMessagePush = kind.includes("message") || Boolean(chatId && messageId);
  const fallbackTag = isMessagePush && chatId
    ? `message:chat:${chatId}`
    : taskId
      ? `task:${taskId}`
      : inviteId
        ? `invite:${inviteId}`
        : chatId
          ? `chat:${chatId}`
          : "kub-notification";
  return {
    title: safeText(proposed.title || data.title, APP_NAME, 80),
    body: safeText(proposed.body || data.body || data.message || data.text, DEFAULT_PUSH_BODY, 180),
    tag: safeText(proposed.tag || data.tag, fallbackTag, 100),
    renotify: typeof data.renotify === "boolean" ? data.renotify : true,
    kind,
    isMessagePush,
    chatId,
    messageId,
    timestamp: safeTimestamp(data.timestamp || data.createdAt || data.created_at),
    url: routeForPush({ ...data, navigate: proposed.navigate }, { chatId, messageId, taskId, inviteId }),
  };
}

function routeForPush(data, ids) {
  const explicit = ensureRelativeUrl(data.navigate || data.url || data.route);
  if (explicit !== "/") return explicit;
  if (ids.chatId && ids.messageId) {
    return `/?chat=${encodeURIComponent(ids.chatId)}&message=${encodeURIComponent(ids.messageId)}`;
  }
  if (ids.chatId) return `/?chat=${encodeURIComponent(ids.chatId)}`;
  if (ids.taskId) return `/tasks?task=${encodeURIComponent(ids.taskId)}`;
  if (ids.inviteId) return `/?notifications=1`;
  return "/";
}

function safeText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (!text || looksSensitive(text)) return fallback;
  return text.slice(0, maxLength);
}

function safeId(value) {
  if (typeof value !== "string") return "";
  return /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : "";
}

function safeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function ensureRelativeUrl(value) {
  if (typeof value !== "string" || looksSensitive(value)) return "/";
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function looksSensitive(value) {
  const lower = value.toLowerCase();
  // `/storage/v1/` is the storage API's path on every Supabase host, the
  // self-hosted one included, so it needs no host name beside it.
  return (
    lower.includes("/storage/v1/") ||
    lower.includes("token=") ||
    lower.includes("password=") ||
    lower.includes("authorization=")
  );
}
