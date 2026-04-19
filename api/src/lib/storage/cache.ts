/**
 * Cache layer using the Cloudflare Cache API.
 *
 * Stores pre-extracted chunk data to avoid repeated fetches.
 * Falls back to in-memory Map when Cache API is unavailable (local dev).
 *
 * Cloudflare Cache API (Workers):
 *   - Same datacenter as the Worker — reads are ~1ms
 *   - Persists across Worker invocations (unlike in-memory Map)
 *   - Keys are Request objects or URL strings
 *   - Max entry size: 512 MB
 *   - No eviction pressure for small entries
 */

const CACHE_NAME = "openzenith-dem-chunks";

interface CacheEntry {
  data: ArrayBuffer;
  timestamp: number;
}

/** In-memory fallback for local dev (no CF Cache API). */
const memoryCache = new Map<string, CacheEntry>();

/** Default TTL: 30 days — elevation data is static and never changes. */
const TTL = 30 * 24 * 3600;

/**
 * Try to get a cached entry.
 * Returns null on miss or if Cache API is unavailable.
 */
export async function cacheGet(key: string): Promise<ArrayBuffer | null> {
  // Try Cloudflare Cache API first
  if (typeof caches !== "undefined") {
    try {
      const cfCache = await caches.open(CACHE_NAME);
      const cached = await cfCache.match(key);
      if (cached) return cached.arrayBuffer();
    } catch {
      // Cache API not available (local dev)
    }
  }

  // Fall back to in-memory cache
  const entry = memoryCache.get(key);
  if (entry) {
    const age = (Date.now() - entry.timestamp) / 1000;
    if (age < TTL) {
      return entry.data;
    }
    memoryCache.delete(key);
  }

  return null;
}

/**
 * Store an entry in the cache.
 */
export async function cachePut(key: string, data: ArrayBuffer): Promise<void> {
  // Try Cloudflare Cache API first
  if (typeof caches !== "undefined") {
    try {
      const cfCache = await caches.open(CACHE_NAME);
      const response = new Response(data, {
        headers: {
          "Cache-Control": `public, max-age=${TTL}`,
          "Content-Type": "application/octet-stream",
        },
      });
      // Ignore errors — caching is best-effort
      cfCache.put(key, response).catch(() => {});
    } catch {
      // Cache API not available (local dev)
    }
  }

  // Also store in memory as fallback
  memoryCache.set(key, { data, timestamp: Date.now() });
}
