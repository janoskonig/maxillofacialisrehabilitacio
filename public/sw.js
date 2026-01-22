/* eslint-disable no-restricted-globals */
const SW_VERSION = "v1"; // emeld, ha logikát változtatsz (nem kötelező, de hasznos)
const CACHE_NAME = `maxrehab-static-${SW_VERSION}`;

const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/apple-touch-icon.png",
  "/favicon.ico"
];

// Install: előcache-eljünk minimális dolgokat (installálhatóság + ikonok gyorsak)
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(STATIC_ASSETS);
      await self.skipWaiting();
    })()
  );
});

// Activate: régi cache-ek takarítása + azonnali átállás
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("maxrehab-static-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Üzenetkezelés (kliens kérheti a skipWaiting-et)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Fetch stratégia:
// - ikonok, manifest, favicon: cache-first
// - Next statikus chunkok (/_next/static/...): stale-while-revalidate jelleg (cache, de frissít)
// - API: network-only (ne cache-eljünk)
// - minden más: network-first (de ha nincs net, fallback cache ha van)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Csak same-origin
  if (url.origin !== self.location.origin) return;

  // API ne legyen cache-elve
  if (url.pathname.startsWith("/api/")) {
    return; // default network
  }

  // Cache-first ikonok/manifest/favicon
  const isIconLike =
    url.pathname === "/manifest.json" ||
    url.pathname === "/favicon.ico" ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/apple-touch-icon.png";

  if (isIconLike) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        cache.put(req, fresh.clone());
        return fresh;
      })()
    );
    return;
  }

  // Next statikus: cache + háttérben frissít
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((fresh) => {
            cache.put(req, fresh.clone());
            return fresh;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })()
    );
    return;
  }

  // Default: network-first, fallback cache
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(req);
        // csak GET-et tegyünk cache-be
        if (req.method === "GET" && fresh && fresh.status === 200) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        // ha semmi nincs cache-ben, dobjuk vissza jobb hibaüzenettel
        return new Response(
          "Az alkalmazás offline módban nem elérhető. Kérjük, ellenőrizze az internetkapcsolatot.",
          { 
            status: 503, 
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          }
        );
      }
    })()
  );
});
