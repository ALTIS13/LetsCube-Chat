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
const WEB_PREVIEW_RPC = "https://core.letscube.ru/rest/v1/rpc/web_message_preview_content";
const WEB_PREVIEW_DB = "letscube-web-message-preview";
const WEB_PREVIEW_STORE = "state";
const WEB_PREVIEW_MAX_TTL = 2592000000;
let previewWrites = Promise.resolve();
let previewChange = 0;
let previewStorageFailed = false;
let previewBlocked = false;

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
  if (typeof event.data?.type === "string" && event.data.type.startsWith("LETSCUBE_WEB_PREVIEW_")) {
    const pending = handleWebPreviewMessage(event);
    if (typeof event.waitUntil === "function") event.waitUntil(pending);
    return;
  }
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
    raw = event.data ? event.data.json() : declarativePushPayload(event.notification);
  } catch {
    raw = { body: event.data ? event.data.text() : "" };
  }

  const data = normalizePushPayload(raw);

  event.waitUntil(showPushNotification(data));
});

function declarativePushPayload(notification) {
  // Mutable declarative push has null event.data. Notification display fields
  // are not authority: only routing and a fresh-lookup selector cross here.
  const data = notification?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const keys = ["kind", "url", "tag", "chatId", "messageId", "renotify"];
  if (!previewExact(data, Object.hasOwn(data, "web_preview") ? [...keys, "web_preview"] : keys)
    || ["kind", "url", "tag", "chatId", "messageId"].some(key => typeof data[key] !== "string")
    || typeof data.renotify !== "boolean") return {};
  return { ...data };
}

async function showPushNotification(data) {
  const preview = await lookupWebPreview(data);
  await closePushNotificationTag(data.tag);
  // No await remains between this final durable recheck and FIRST publication.
  const readable = preview && await currentWebPreview(preview);
  return self.registration.showNotification(readable ? preview.content.title : data.title, {
    navigate: new URL(data.url, self.location.origin).href,
    body: readable ? preview.content.body : data.body,
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

// A second click must see the window opened by the first, not open its own.
let notificationClicks = Promise.resolve();
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = ensureRelativeUrl(event.notification.data?.url || "/");

  const opening = notificationClicks.then(async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if (!isNotificationWindow(client)) continue;
      try {
        const focused = await client.focus();
        const current = focused && await self.clients.get(focused.id);
        if (!isNotificationWindow(current)) continue;
        current.postMessage({ type: "kub-open", url: targetUrl });
        return;
      } catch {
        // A closed or not-yet-active client must not swallow the click.
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(new URL(targetUrl, self.location.origin).href);
    }
  });
  notificationClicks = opening.catch(() => {});
  event.waitUntil(opening);
});

function isNotificationWindow(client) {
  if (!client || client.type !== "window" || client.frameType === "nested") return false;
  try {
    return new URL(client.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

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
    title: isMessagePush ? APP_NAME : safeText(proposed.title || data.title, APP_NAME, 80),
    body: isMessagePush ? DEFAULT_PUSH_BODY : safeText(proposed.body || data.body || data.message || data.text, DEFAULT_PUSH_BODY, 180),
    tag: safeText(proposed.tag || data.tag, fallbackTag, 100),
    renotify: typeof data.renotify === "boolean" ? data.renotify : true,
    kind,
    isMessagePush,
    webPreview: isMessagePush ? webPreviewSelector(data.web_preview) : null,
    chatId,
    messageId,
    timestamp: safeTimestamp(data.timestamp || data.createdAt || data.created_at),
    url: routeForPush({ ...data, navigate: proposed.navigate }, { chatId, messageId, taskId, inviteId }),
  };
}

function previewExact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function previewId(value) {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
}

function previewInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function previewOwner(value) {
  return previewExact(value, ["userId", "sessionId", "accountEpoch"])
    && previewId(value.userId) && previewId(value.sessionId) && previewInteger(value.accountEpoch);
}

function webPreviewSelector(value) {
  return previewExact(value, ["preview_v", "subscription_id", "notification_id"])
    && value.preview_v === 1 && previewId(value.subscription_id) && previewId(value.notification_id)
    ? { ...value } : null;
}

function previewPublicKey(key) {
  if (typeof key !== "string" || key.length > 2048) return false;
  if (/^sb_publishable_[a-zA-Z0-9_-]{16,512}$/.test(key)) return true;
  try {
    const parts = key.split(".");
    return parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))
      && JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "anon";
  } catch { return false; }
}

function previewContext(context, owner) {
  return previewExact(context, ["preview_v", "recipient_id", "session_id", "subscription_id", "subscription_fingerprint",
    "revision", "preview_level", "installation_consent", "observed_at_epoch_ms", "expires_at_epoch_ms"])
    && context.preview_v === 1 && previewOwner(owner) && context.recipient_id === owner.userId && context.session_id === owner.sessionId
    && previewId(context.subscription_id) && /^v1:[a-f0-9]{64}$/.test(context.subscription_fingerprint)
    && previewInteger(context.revision) && context.revision > 0
    && ["sender", "message"].includes(context.preview_level) && context.installation_consent === true
    && previewInteger(context.observed_at_epoch_ms) && previewInteger(context.expires_at_epoch_ms)
    && context.expires_at_epoch_ms > context.observed_at_epoch_ms
    && context.expires_at_epoch_ms - context.observed_at_epoch_ms <= WEB_PREVIEW_MAX_TTL;
}

// Shared Hume browser lifecycle owns state/current. The worker writes only the
// nonsecret API confirmation key, never a second owner/grant state machine.
// Each operation uses a fresh transaction. No transaction spans network IO.
function previewRecord(update) {
  return new Promise((resolve, reject) => {
    let db, tx, result, settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true; clearTimeout(timer); if (db) db.close();
      if (ok) resolve(result); else reject(new Error("WEB_PREVIEW_STORAGE_UNAVAILABLE"));
    };
    const timer = setTimeout(() => {
      try { if (tx) tx.abort(); } catch { /* A completed transaction cannot be aborted. */ }
      finish(false);
    }, 2000);
    try {
      const open = indexedDB.open(WEB_PREVIEW_DB, 1);
      open.onerror = open.onblocked = () => finish(false);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(WEB_PREVIEW_STORE)) open.result.createObjectStore(WEB_PREVIEW_STORE);
      };
      open.onsuccess = () => {
        db = open.result;
        if (settled) { db.close(); return; }
        try {
          tx = db.transaction(WEB_PREVIEW_STORE, update ? "readwrite" : "readonly");
          tx.onabort = tx.onerror = () => finish(false);
          tx.oncomplete = () => finish(true);
          const store = tx.objectStore(WEB_PREVIEW_STORE), record = store.get("current"), api = store.get("worker-public-api");
          let remaining = 2;
          const read = () => {
            if (--remaining) return;
            try {
              result = { record: record.result, api: api.result };
              if (update) { result.api = update(result.record); store.put(result.api, "worker-public-api"); }
            } catch { tx.abort(); }
          };
          record.onsuccess = api.onsuccess = read;
        } catch { finish(false); }
      };
    } catch { finish(false); }
  });
}

function handleWebPreviewMessage(event) {
  const port = event.ports && event.ports[0], source = event.source;
  const reply = value => { if (port) port.postMessage(value); };
  let data;
  try {
    // Snapshot before the first await; only structured-clone JSON is consumed.
    data = JSON.parse(JSON.stringify(event.data));
    if (!source || source.type !== "window" || new URL(source.url).origin !== self.location.origin || data.v !== 1) throw new Error();
    const install = data.type === "LETSCUBE_WEB_PREVIEW_INSTALL";
    const retire = data.type === "LETSCUBE_WEB_PREVIEW_RETIRE";
    const keys = retire ? ["type", "v"] : ["type", "v", "intent_id", "generation", "context", "public_key"];
    if ((!install && !retire) || !previewExact(data, keys)) throw new Error();
    if (install && (!port || source.visibilityState !== "visible" || !previewId(data.intent_id)
      || !previewInteger(data.generation) || data.generation < 1 || !previewPublicKey(data.public_key))) throw new Error();
    // In-flight lookups are synchronously invalidated when intent arrives, even
    // while its durable retirement is still queued. Stale writes remain CAS'd.
    const change = ++previewChange;
    if (retire) {
      previewBlocked = true;
      reply({ type: "LETSCUBE_WEB_PREVIEW_RESULT", ok: true });
      return Promise.resolve();
    }
    const pending = previewWrites.then(async () => {
      const stored = await previewRecord(record => {
        if (change !== previewChange || !usablePreviewRecord(record) || record.generation !== data.generation || record.intent_id !== data.intent_id
          || !previewContext(data.context, record.owner)
          || Object.keys(record.envelope.context).some(key => record.envelope.context[key] !== data.context[key])) throw new Error();
        return { api_v: 1, generation: data.generation, intent_id: data.intent_id, public_key: data.public_key };
      });
      const confirmed = await previewRecord();
      if (change !== previewChange || JSON.stringify(confirmed) !== JSON.stringify(stored)) throw new Error();
      previewStorageFailed = false;
      previewBlocked = false;
      reply({ type: "LETSCUBE_WEB_PREVIEW_RESULT", ok: true, generation: stored.record.generation,
        intent_id: stored.record.intent_id, installed: true, web_push_protocol: 1 });
    });
    previewWrites = pending.catch(() => { previewStorageFailed = true; reply({ type: "LETSCUBE_WEB_PREVIEW_RESULT", ok: false }); });
    return previewWrites;
  } catch {
    reply({ type: "LETSCUBE_WEB_PREVIEW_RESULT", ok: false });
    return Promise.resolve();
  }
}

function usablePreviewRecord(record) {
  return previewExact(record, ["record_v", "generation", "intent_id", "owner", "state", "envelope", "accepted_at_epoch_ms", "deadline_at_epoch_ms"])
    && record.record_v === 1 && record.state === "active" && previewInteger(record.generation) && record.generation > 0
    && previewId(record.intent_id) && previewOwner(record.owner)
    && record.envelope?.storage_v === 1 && previewContext(record.envelope.context, record.owner)
    && previewExact(record.envelope, ["storage_v", "context", "grant_secret"]) && /^wpg1_[a-f0-9]{64}$/.test(record.envelope.grant_secret)
    && previewInteger(record.accepted_at_epoch_ms) && previewInteger(record.deadline_at_epoch_ms)
    && record.deadline_at_epoch_ms > record.accepted_at_epoch_ms
    && record.deadline_at_epoch_ms - record.accepted_at_epoch_ms <= WEB_PREVIEW_MAX_TTL
    && Date.now() >= record.accepted_at_epoch_ms && Date.now() < record.deadline_at_epoch_ms;
}

function usablePreviewState(state) {
  return usablePreviewRecord(state?.record) && previewExact(state.api, ["api_v", "generation", "intent_id", "public_key"])
    && state.api.api_v === 1 && state.api.generation === state.record.generation && state.api.intent_id === state.record.intent_id
    && previewPublicKey(state.api.public_key);
}

function previewContent(row, record, data) {
  const context = record.envelope.context;
  const text = (value, max) => typeof value === "string" && value.length > 0 && Array.from(value).length <= max
    && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]|\s{2,}/u.test(value) && !looksSensitive(value);
  return previewExact(row, ["preview_v", "recipient_id", "session_id", "subscription_id", "subscription_fingerprint", "revision",
    "notification_id", "chat_id", "message_id", "preview_level", "sender_name", "title", "body", "observed_at_epoch_ms", "expires_at_epoch_ms"])
    && ["preview_v", "recipient_id", "session_id", "subscription_id", "subscription_fingerprint", "revision", "preview_level"].every(key => row[key] === context[key])
    && row.notification_id === data.webPreview.notification_id && row.chat_id === data.chatId && row.message_id === data.messageId
    && previewId(row.chat_id) && previewId(row.message_id)
    && text(row.sender_name, 96) && text(row.title, 96) && text(row.body, 240)
    && (row.preview_level !== "sender" || row.body === "Новое сообщение")
    && previewInteger(row.observed_at_epoch_ms) && previewInteger(row.expires_at_epoch_ms)
    && row.observed_at_epoch_ms >= context.observed_at_epoch_ms
    && row.expires_at_epoch_ms > row.observed_at_epoch_ms && row.expires_at_epoch_ms - row.observed_at_epoch_ms <= 15000
    && row.expires_at_epoch_ms <= context.expires_at_epoch_ms;
}

async function lookupWebPreview(data) {
  if (!data.webPreview || previewStorageFailed || previewBlocked) return null;
  try {
    await previewWrites;
    const change = previewChange, state = await previewRecord(), record = state.record;
    if (previewStorageFailed || previewBlocked || change !== previewChange || !usablePreviewState(state)
      || record.envelope.context.subscription_id !== data.webPreview.subscription_id) return null;
    const wall = Date.now(), monotonic = performance.now(), controller = new AbortController();
    let timer;
    try {
      const read = async () => {
        const key = state.api.public_key;
        const response = await fetch(WEB_PREVIEW_RPC, { method: "POST", credentials: "omit", redirect: "error", cache: "no-store",
          referrerPolicy: "no-referrer", signal: controller.signal,
          headers: { "Content-Type": "application/json", apikey: key, ...(key.startsWith("sb_publishable_") ? {} : { Authorization: "Bearer " + key }) },
          body: JSON.stringify({ p_grant_secret: record.envelope.grant_secret, p_notification_id: data.webPreview.notification_id }) });
        if (!response.ok || response.redirected || !response.body) return null;
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.byteLength; if (size > 8192) return null;
            chunks.push(chunk.value);
          }
        } finally { reader.cancel().catch(() => {}); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const rows = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!Array.isArray(rows) || rows.length !== 1 || !previewContent(rows[0], record, data)) return null;
        return { state, content: rows[0], change, wall, monotonic };
      };
      return await Promise.race([read(), new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000); })]);
    } finally { clearTimeout(timer); controller.abort(); }
  } catch { return null; }
}

async function currentWebPreview(preview) {
  try {
    await previewWrites;
    const state = await previewRecord(), elapsed = performance.now() - preview.monotonic;
    return !previewStorageFailed && !previewBlocked && preview.change === previewChange && usablePreviewState(state)
      && JSON.stringify(state) === JSON.stringify(preview.state)
      && Date.now() >= preview.wall && elapsed >= 0 && elapsed < preview.content.expires_at_epoch_ms - preview.content.observed_at_epoch_ms
      && Date.now() - preview.wall < preview.content.expires_at_epoch_ms - preview.content.observed_at_epoch_ms;
  } catch { return false; }
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
