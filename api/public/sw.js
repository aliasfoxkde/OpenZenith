const CACHE_NAME = "openzenith-v1";

// CDN hosts to cache (CesiumJS, MapLibre tiles, etc.)
const CDN_HOSTS = [
  "cesium.com",
  "unpkg.com",
  "cdn.jsdelivr.net",
  "tile.openstreetmap.org",
  "basemaps.cartocdn.com",
  "tiles.stadiamaps.com",
  "map1.vis.earthdata.nasa.gov",
  "gibs.earthdata.nasa.gov",
  "tilecache.rainviewer.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        "/",
        "/globe",
        "/map",
        "/manifest.json",
        "/favicon.svg",
        "/icon-192.png",
        "/icon-512.png",
        "/apple-touch-icon.png",
        "/offline.html",
      ])
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Only handle same-origin or known CDN requests
  if (url.origin !== location.origin && !CDN_HOSTS.some((h) => url.hostname.includes(h))) return;

  // Static assets: cache first
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // DEM terrain tiles: cache first with long TTL (tiles are immutable)
  if (url.pathname.startsWith("/api/dem-tile/") || url.pathname.startsWith("/api/tile/")) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // API routes: stale while revalidate
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Navigation requests: network first with offline fallback
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "/offline.html"));
    return;
  }

  // Everything else: stale while revalidate
  event.respondWith(staleWhileRevalidate(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached;
  }
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached || networkPromise;
}
