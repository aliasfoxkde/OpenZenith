/// <reference lib="webworker" />

const CACHE_NAME = "openzenith-v1";
const PRECACHE_URLS = [
  "/",
  "/map",
  "/explore",
];

// Tile domains to cache on-demand
const TILE_CACHE_DOMAINS = [
  "basemaps.cartocdn.com",
  "tile.openstreetmap.org",
  "server.arcgisonline.com",
  "tile.opentopomap.org",
  "tiles.stadiamaps.com",
];

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  (self as unknown as ServiceWorkerGlobalScope).skipWaiting();
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  (self as unknown as ServiceWorkerGlobalScope).clients.claim();
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Cache API responses (OpenZenith API routes)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          // Return cached, refresh in background
          const fresh = fetch(event.request).then((resp) => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          });
          return cached;
        }
        const resp = await fetch(event.request);
        if (resp.ok) cache.put(event.request, resp.clone());
        return resp;
      }),
    );
    return;
  }

  // Cache tile requests on-demand (stale-while-revalidate)
  if (TILE_CACHE_DOMAINS.some((d) => url.hostname.includes(d)) && url.pathname.match(/\\d+\\/\\d+\\/\\d+/)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const resp = await fetch(event.request);
        if (resp.ok) cache.put(event.request, resp.clone());
        return resp;
      }),
    );
    return;
  }

  // Navigation requests — cache-first
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request)),
    );
  }
});

export {};
