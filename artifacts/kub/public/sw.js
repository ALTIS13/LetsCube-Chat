const CACHE_NAME = "kub-app-shell-v2";
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
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))),
    ),
  );
});

self.addEventListener("activate", (event) => {
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
  if (event.data?.type === "KUB_CLOSE_NOTIFICATION") {
    const tag = safeText(event.data?.tag, "", 120);
    if (!tag) return;
    const closeMatching = self.registration.getNotifications({ tag }).then((notifications) => {
      notifications.forEach((notification) => notification.close());
    });
    if (typeof event.waitUntil === "function") event.waitUntil(closeMatching);
  }
});

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

  const url = new URL(request.url);
  if (isSupabaseUrl(url)) return;
  if (!isSameOrigin(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isCacheableStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put("/", response.clone());
    return response;
  } catch {
    return (await cache.match("/")) || (await cache.match("/offline.html"));
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await fresh) || (await cache.match("/offline.html"));
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isSupabaseUrl(url) {
  return url.hostname.endsWith(".supabase.co");
}

function isCacheableStaticAsset(url) {
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
  const existing = await self.registration.getNotifications({ tag: data.tag });
  existing.forEach((notification) => notification.close());
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
  return (
    lower.includes("/storage/v1/") ||
    lower.includes(".supabase.co/storage") ||
    lower.includes("token=") ||
    lower.includes("password=") ||
    lower.includes("authorization=")
  );
}
