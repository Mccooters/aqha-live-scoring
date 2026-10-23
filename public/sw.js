// HCQHA Live service worker: web push notifications (spectators) and the
// offline shell for the judge page (schema-v63 — judges score with no
// reception; see app/event/[id]/judge/page.js).

const SHELL_CACHE = "judge-shell-v1";

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "HCQHA Show Update", {
      body: data.body ?? "",
      tag: data.tag ?? "show-update",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes("/event/") && "focus" in client) return client.focus();
      }
      return clients.openWindow("/");
    })
  );
});

// Offline shell. Only the judge page is served from cache: its document is
// network-first (so a deploy is picked up whenever there IS reception) with
// the cached copy as the fallback, and the site's hashed static chunks are
// cache-first (their names change with every build, so a cached one is
// never stale). Everything else — API calls, Supabase, other pages — goes
// straight to the network as before.
const isJudgePage = (url) => url.origin === self.location.origin && /^\/event\/[^/]+\/judge\/?$/.test(url.pathname);
const isStaticChunk = (url) => url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");
const isFont = (url) => /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }

  if (req.mode === "navigate" && isJudgePage(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(url.pathname, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(url.pathname) || await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        return new Response("<h1>Offline</h1><p>Open the judge link once while you have reception, then it works without one.</p>", { headers: { "Content-Type": "text/html" }, status: 503 });
      }
    })());
    return;
  }

  if (isStaticChunk(url) || isFont(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && (fresh.ok || fresh.type === "opaque")) cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        throw err;
      }
    })());
  }
});
