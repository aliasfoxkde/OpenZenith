/**
 * Cache layer using the Cloudflare Cache API.
 *
 * Stores pre-extracted chunk data to avoid repeated fetches.
 * Falls back to in-memory Map when Cache API is unavailable (local dev).
 */

interface CacheEntry {
  data: ArrayBuffer;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfCache = (caches as any).default as Cache | undefined;
      if (cfCache) {
        const cached = await cfCache.match(key);
        if (cached) return cached.arrayBuffer();
      }
    } catch {
      // Cache API not available (local dev)
    }
  }

  // Fall back to in-memory cache
  const entry = cache.get(key);
  if (entry) {
    const age = (Date.now() - entry.timestamp) / 1000;
    if (age < TTL) {
      return entry.data;
    }
    cache.delete(key);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfCache = (caches as any).default as Cache | undefined;
      if (cfCache) {
        const response = new Response(data, {
          headers: {
            "Cache-Control": `public, max-age=${TTL}`,
            "Content-Type": "application/octet-stream",
          },
        });
        await cfCache.put(key, response);
      }
    } catch {
      // Cache API not available (local dev)
    }
  }

  // Also store in memory as fallback
  cache.set(key, { data, timestamp: Date.now() });
}
