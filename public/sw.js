/* eslint-disable no-restricted-globals */
const SW_VERSION = "v1"; // emeld, ha logikát változtatsz (nem kötelező, de hasznos)
const CACHE_NAME = `maxrehab-static-${SW_VERSION}`;

const STATIC_ASSETS = [
  "/manifest.json",
  "/icon-192x192.png",
  "/icon-512x512.png",
  "/apple-touch-icon.png"
];

// Install: előcache-eljünk minimális dolgokat (installálhatóság + ikonok gyorsak)
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        // Egyenként cache-eljük, hogy ha valamelyik fájl hiányzik, ne akadjon el
        const cachePromises = STATIC_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url);
            if (response && response.status === 200) {
              await cache.put(url, response);
              console.log(`[SW] Cached: ${url}`);
            } else {
              console.warn(`[SW] Failed to cache ${url}: status ${response?.status}`);
            }
          } catch (error) {
            console.warn(`[SW] Failed to cache ${url}:`, error);
            // Folytatjuk, még ha valamelyik fájl nem elérhető
          }
        });
        await Promise.allSettled(cachePromises);
        await self.skipWaiting();
        console.log("[SW] Service Worker installed successfully");
      } catch (error) {
        console.error("[SW] Installation error:", error);
        // Még akkor is skipWaiting, hogy a SW aktiválódjon
        await self.skipWaiting();
      }
    })()
  );
});

// Activate: régi cache-ek takarítása + azonnali átállás
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith("maxrehab-static-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        );
        await self.clients.claim();
        console.log("[SW] Service Worker activated");
      } catch (error) {
        console.error("[SW] Activation error:", error);
      }
    })()
  );
});

// Üzenetkezelés (kliens kérheti a skipWaiting-et)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Push event: notification megjelenítése
self.addEventListener("push", (event) => {
  console.log("[SW] Push event received");
  
  let data = {};
  
  if (event.data) {
    try {
      data = event.data.json();
      console.log("[SW] Push data parsed:", data);
    } catch (e) {
      console.log("[SW] Push data is not JSON, using text:", e);
      data = {
        title: "MaxRehab",
        body: event.data.text() || "Új értesítés",
      };
    }
  } else {
    console.log("[SW] No push data, using default");
    data = {
      title: "MaxRehab",
      body: "Új értesítés",
    };
  }

  const options = {
    title: data.title || "MaxRehab",
    body: data.body || "Új értesítés",
    icon: data.icon || "/icon-192x192.png",
    badge: data.badge || "/icon-192x192.png",
    tag: data.tag || "default",
    data: data.data || {},
    requireInteraction: data.requireInteraction || false,
    vibrate: data.vibrate || [200, 100, 200],
    actions: data.actions || [],
  };

  console.log("[SW] Showing notification with options:", options);

  event.waitUntil(
    self.registration.showNotification(options.title, options)
      .then(() => {
        console.log("[SW] Notification shown successfully");
      })
      .catch((error) => {
        console.error("[SW] Error showing notification:", error);
      })
  );
});

// Notification click: app megnyitása
self.addEventListener("notificationclick", (event) => {
  console.log("[SW] Notification clicked");
  event.notification.close();

  const data = event.notification.data || {};
  const urlToOpen = data.url || "/";

  console.log("[SW] Opening URL:", urlToOpen);

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      console.log("[SW] Found clients:", clientList.length);
      // Ha van már megnyitott ablak, fókuszáljuk
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && "focus" in client) {
          console.log("[SW] Focusing existing client");
          return client.focus();
        }
      }
      // Ha nincs megnyitott ablak, nyissunk egy újat
      if (clients.openWindow) {
        console.log("[SW] Opening new window");
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Notification close: opcionális logolás
self.addEventListener("notificationclose", (event) => {
  // Opcionális: analytics vagy logolás
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
