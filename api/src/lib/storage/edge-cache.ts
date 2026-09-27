/**
 * Shared cache-aside store on the Cloudflare Cache API.
 *
 * Replaces the former R2-backed caches (r2-tile-cache / r2-json-cache) as part
 * of the R2 exit: the platform now runs on free storage only, and the Cache
 * API is free and needs no binding. The trade is scope — Cache API entries are
 * per-colo rather than globally durable — which every consumer here accepts:
 * each has a live upstream (HuggingFace tiles, edge-rendered tiles,
 * third-party APIs), so the cache is a latency optimization, not a source of
 * truth.
 *
 * Entries are addressed as URLs under a synthetic origin (the Cache API keys
 * on URLs). Freshness is enforced explicitly via an `x-cached-at` timestamp +
 * `x-cache-ttl` header on each stored response instead of trusting the runtime
 * to evict on `max-age` — an entry past its TTL reads as a miss.
 */

/** Rendered-tile schema version — see `RENDERED_TYPES` below. Bumped to 2
 * when the OZCHNK01 edge-chunk decode was fixed (#124): pre-fix renders could
 * carry -6385m stripes. */
export const RENDER_SCHEMA_VERSION = 2;

/** Default TTL for edge-rendered tiles (immutable for a given schema). */
const RENDERED_TILE_TTL_SECONDS = 365 * 24 * 60 * 60;
/** Default TTL for passthrough/upstream tile types (data can refresh upstream). */
const PASSTHROUGH_TILE_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Default TTL for cached JSON API responses. */
const DEFAULT_JSON_TTL_SECONDS = 60;

const CACHE_NAMESPACE = "openzenith-edge-cache-v1";
const KEY_ORIGIN = "https://edge-cache.openzenith.internal";

/**
 * Tile types whose bytes this worker RENDERS from the SRTM decode. Only these
 * get the version segment in their key. Types storing offline-generated or
 * upstream-source bytes (e.g. "landcover"/"population"/"sentinel2"/GIBS
 * passthroughs) are NOT listed: their bytes do not depend on the edge decoder,
 * so versioning them would only orphan valid data — they get the shorter
 * passthrough TTL instead.
 */
const RENDERED_TYPES = new Set(["dem-tile", "elevation-color", "contours", "dem-raw"]);

/** Minimal Cache surface these helpers rely on (structural, so tests can fake it). */
interface EdgeCacheLike {
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  put(request: RequestInfo | URL, response: Response): Promise<void>;
}

/** Minimal CacheStorage surface — `caches` on Workers/Pages. */
interface CacheStorageLike {
  open(name: string): Promise<EdgeCacheLike>;
}

function fromGlobalCaches(): CacheStorageLike | null {
  try {
    // `caches` exists on the Workers/Pages runtime; Node and vitest have none.
    const caches = (globalThis as { caches?: CacheStorageLike }).caches;
    return caches && typeof caches.open === "function" ? caches : null;
  } catch {
    return null;
  }
}

let provider: () => CacheStorageLike | null = fromGlobalCaches;

/**
 * Override where the Cache API is resolved from. Tests pass an in-memory
 * implementation; pass `null` to restore the default global resolution.
 */
export function setEdgeCacheProvider(next: (() => CacheStorageLike | null) | null): void {
  provider = next ?? fromGlobalCaches;
}

/** Resolve the cache store, or null when unavailable (local dev / tests). */
function getCacheStore(): CacheStorageLike | null {
  try {
    return provider();
  } catch {
    return null;
  }
}

function cacheKeyUrl(key: string): string {
  return `${KEY_ORIGIN}/${key.replace(/^\//, "")}`;
}

/** Tile cache key; rendered types are versioned so schema changes orphan old bytes. */
function tileKey(type: string, z: number, x: number, y: number): string {
  const version = RENDERED_TYPES.has(type) ? `v${RENDER_SCHEMA_VERSION}/` : "";
  return `${type}/${version}${z}/${x}/${y}`;
}

/**
 * True when a stored response is past its TTL. Entries without both a
 * timestamp and a TTL are treated as expired rather than served.
 */
function isExpired(hit: Response): boolean {
  const cachedAt = parseInt(hit.headers.get("x-cached-at") || "0", 10);
  const ttl = parseInt(hit.headers.get("x-cache-ttl") || "0", 10);
  if (!cachedAt || !ttl) return true;
  return (Date.now() - cachedAt) / 1000 >= ttl;
}

/**
 * Try to get a cached tile. Returns null on miss, expiry, or if the Cache API
 * is unavailable.
 */
export async function edgeGetTile(type: string, z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  const store = getCacheStore();
  if (!store) return null;

  try {
    const cache = await store.open(CACHE_NAMESPACE);
    const hit = await cache.match(cacheKeyUrl(tileKey(type, z, x, y)));
    if (!hit || isExpired(hit)) return null;
    return await hit.arrayBuffer();
  } catch {
    // Cache unavailable or error — fall through to generation
    return null;
  }
}

/**
 * Store a generated tile for future requests. Best-effort — errors are
 * silently ignored. Rendered types default to a 1-year TTL (their key carries
 * the schema version); passthrough types default to 30 days.
 */
export async function edgePutTile(
  type: string,
  z: number,
  x: number,
  y: number,
  data: ArrayBuffer | Uint8Array,
  contentType: string = "application/octet-stream",
  ttlSeconds?: number,
): Promise<void> {
  const store = getCacheStore();
  if (!store) return;

  const ttl = ttlSeconds ?? (RENDERED_TYPES.has(type) ? RENDERED_TILE_TTL_SECONDS : PASSTHROUGH_TILE_TTL_SECONDS);

  try {
    const cache = await store.open(CACHE_NAMESPACE);
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}`,
      "x-cached-at": String(Date.now()),
      "x-cache-ttl": String(ttl),
    });
    // Copies Uint8Array views into an exact-size ArrayBuffer — payload sizes
    // here are single tiles (≤ ~100KB), so the copy is negligible.
    const body = data instanceof Uint8Array ? new Uint8Array(data).buffer : data;
    await cache.put(cacheKeyUrl(tileKey(type, z, x, y)), new Response(body, { headers }));
  } catch {
    // Cache write failed — tile generation still works, just not cached
  }
}

/**
 * Cache a JSON API response with a TTL.
 *
 * @param key - Cache key (e.g., "api/earthquakes?period=all_day")
 * @param data - JSON-serializable data
 * @param ttlSeconds - How long to cache (default 60s)
 */
export async function edgePutJson(key: string, data: unknown, ttlSeconds: number = DEFAULT_JSON_TTL_SECONDS): Promise<void> {
  const store = getCacheStore();
  if (!store) return;

  try {
    const cache = await store.open(CACHE_NAMESPACE);
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
      "x-cached-at": String(Date.now()),
      "x-cache-ttl": String(ttlSeconds),
    });
    await cache.put(cacheKeyUrl(key), new Response(JSON.stringify(data), { headers }));
  } catch {
    // Cache write failed — API still works, just not cached
  }
}

/**
 * Get a cached JSON response. Returns null if not cached or expired.
 *
 * @param key - Cache key (e.g., "api/earthquakes?period=all_day")
 */
export async function edgeGetJson<T = unknown>(key: string): Promise<T | null> {
  const store = getCacheStore();
  if (!store) return null;

  try {
    const cache = await store.open(CACHE_NAMESPACE);
    const hit = await cache.match(cacheKeyUrl(key));
    if (!hit || isExpired(hit)) return null;
    return JSON.parse(await hit.text()) as T;
  } catch {
    return null;
  }
}

/**
 * Generate a cache key for an API route.
 * Normalizes the URL to avoid key collisions.
 */
export function apiCacheKey(route: string, params?: Record<string, string>): string {
  const base = `api/${route.replace(/^\//, "")}`;
  if (!params) return base;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}
