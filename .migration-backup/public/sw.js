// КУБ Service Worker.
// Two responsibilities:
//   1. Network-first cache for static assets (so the PWA opens offline).
//   2. Web Push: render notifications, focus/open the app on click.

const CACHE_NAME = "kub-v2";
const STATIC_ASSETS = ["/", "/manifest.json"];
const APP_NAME = "КУБ";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

// ── Push ────────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: APP_NAME, body: event.data ? event.data.text() : "" };
  }

  const title = data.title || APP_NAME;
  const body  = data.body  || "";
  const tag   = data.tag   || data.chatId || "kub-message";
  const url   = data.url   || (data.chatId ? `/?chat=${data.chatId}` : "/");

  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,                  // collapses repeated pushes for the same chat
    renotify: true,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.location.origin)) {
        c.focus();
        c.postMessage({ type: "kub-open", url: targetUrl });
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
