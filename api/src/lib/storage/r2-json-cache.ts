/**
 * R2 cache-aside for JSON API responses.
 *
 * Caches upstream API responses (earthquakes, wildfires, etc.) in R2 with
 * a short TTL. This provides cross-isolate persistence on CF Pages,
 * unlike the Cache API which is isolated per-Worker.
 *
 * Pattern: check R2 → fresh hit? return → miss/stale? fetch upstream → store → return
 */

import { getR2Bucket } from "./r2-binding";

/**
 * Cache a JSON API response in R2 with a TTL.
 *
 * @param key - Cache key (e.g., "api/earthquakes/all_day")
 * @param data - JSON-serializable data
 * @param ttlSeconds - How long to cache (default 60s)
 */
export async function r2PutJson(key: string, data: unknown, ttlSeconds: number = 60): Promise<void> {
  const bucket = getR2Bucket();
  if (!bucket) return;

  try {
    const body = JSON.stringify(data);
    // R2 customMetadata values are strings — encode timestamps as decimal text.
    const metadata = {
      cachedAt: String(Date.now()),
      ttl: String(ttlSeconds * 1000),
    };
    await bucket.put(key, body, {
      httpMetadata: {
        contentType: "application/json",
        cacheControl: `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
      },
      customMetadata: metadata,
    });
  } catch {
    // R2 write failed — API still works, just not cached
  }
}

/**
 * Get a cached JSON response from R2. Returns null if not cached or expired.
 *
 * @param key - Cache key (e.g., "api/earthquakes/all_day")
 * @returns Parsed JSON data or null
 */
export async function r2GetJson<T = unknown>(key: string): Promise<T | null> {
  const bucket = getR2Bucket();
  if (!bucket) return null;

  try {
    const object = await bucket.get(key);
    if (!object) return null;

    // Check TTL via custom metadata
    const cachedAt = parseInt(object.customMetadata?.cachedAt || "0", 10);
    const ttl = parseInt(object.customMetadata?.ttl || "60000", 10);
    if (Date.now() - cachedAt > ttl) {
      // Expired — don't return stale data for real-time APIs
      // But delete in background to clean up
      bucket.delete(key).catch(() => {});
      return null;
    }

    const body = await object.text();
    return JSON.parse(body) as T;
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
