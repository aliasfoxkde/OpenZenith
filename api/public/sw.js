/// <reference lib="webworker" />

// Plain JS only — this file is served verbatim from public/ and parsed by
// browsers as a classic script (no TypeScript transpilation applies).

const CACHE_NAME = "openzenith-v3";

const PRECACHE_URLS = ["/", "/map", "/explore", "/offline.html"];

// Tile domains to cache on-demand
const TILE_CACHE_DOMAINS = [
  "basemaps.cartocdn.com",
  "tile.openstreetmap.org",
  "server.arcgisonline.com",
  "tile.opentopomap.org",
  "tiles.stadiamaps.com",
];

/** TTL in ms for different response types */
const TILE_API_TTL = 24 * 60 * 60 * 1000; // 24h — terrain tiles are static
const DATA_API_TTL = 2 * 60 * 1000; // 2min — real-time data refreshes
const GEO_API_TTL = 24 * 60 * 60 * 1000; // 24h — geocoding rarely changes

/**
 * Determine cache TTL based on URL path.
 */
function getCacheTTL(url) {
  const p = url.pathname;
  // Terrain tile APIs (static elevation data)
  if (p.match(/^\/api\/(dem-tile|elevation-color|elevation-accuracy|contours|hillshade)\/\d+\/\d+\/\d+/)) {
    return TILE_API_TTL;
  }
  // Overlay tile APIs (semi-static)
  if (p.match(/^\/api\/(landcover|population|sentinel2)\/\d+\/\d+\/\d+/)) {
    return TILE_API_TTL;
  }
  // Geocoding (rarely changes)
  if (p.includes("/geocode") || p.includes("/reverse-geocode") || p.includes("/geoip")) {
    return GEO_API_TTL;
  }
  // Everything else — real-time data, short TTL
  return DATA_API_TTL;
}

/** Check if a cached response is still fresh. */
function isFresh(response, maxAge) {
  const cachedAt = parseInt(response.headers.get("x-sw-cached-at") || "0", 10);
  if (!cachedAt) return false;
  return Date.now() - cachedAt < maxAge;
}

/** Add timestamp header for TTL tracking. */
function withTimestamp(response) {
  const headers = new Headers(response.headers);
  headers.set("x-sw-cached-at", String(Date.now()));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
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
  const url = new URL(event.request.url);

  // OpenZenith API routes — stale-while-revalidate with TTL
  if (url.pathname.startsWith("/api/")) {
    const ttl = getCacheTTL(url);
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached && isFresh(cached, ttl * 2)) {
          // Fresh or within stale window — return cached, revalidate in background if stale
          if (isFresh(cached, ttl)) return cached;
          // Stale but within window — return cached, refresh in background
          fetch(event.request)
            .then((resp) => { if (resp.ok) cache.put(event.request, withTimestamp(resp.clone())); })
            .catch(() => {});
          return cached;
        }
        // Cache miss or expired beyond stale window — must wait
        const resp = await fetch(event.request);
        if (resp.ok) cache.put(event.request, withTimestamp(resp.clone()));
        return resp;
      }),
    );
    return;
  }

  // External basemap tiles — cache-first
  if (TILE_CACHE_DOMAINS.some((d) => url.hostname.includes(d)) && url.pathname.match(/\d+\/\d+\/\d+/)) {
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

  // Navigation requests — cache-first with offline fallback page
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).catch(() => caches.match("/offline.html").then((fallback) => fallback || Response.error())),
      ),
    );
  }
});
