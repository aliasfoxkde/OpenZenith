/**
 * Server-side cache utilities for edge runtime API routes.
 *
 * Uses the Cache API (available in Cloudflare Workers / edge runtime)
 * to avoid redundant upstream fetches for the same request.
 *
 * Usage:
 *   import { cachedFetch } from "@/lib/cache";
 *   const resp = await cachedFetch("https://api.example.com/data", 120);
 *   const data = await resp.json();
 */

/** Default cache namespace to avoid collisions with other workers. */
const CACHE_NAMESPACE = "openzenith-v1";

/**
 * Build a cache key from a URL string.
 * Includes the namespace prefix to avoid conflicts.
 */
function cacheKey(url: string): string {
  return `${CACHE_NAMESPACE}:${url}`;
}

/**
 * Fetch with server-side caching using the Cache API.
 *
 * - Returns cached response if available and not stale.
 * - Fetches fresh from upstream otherwise, caches the result, then returns it.
 * - Falls back to uncached fetch if Cache API is unavailable.
 *
 * @param url - The URL to fetch
 * @param ttlSeconds - Cache TTL in seconds (default 60)
 * @param fetchOpts - Optional fetch options (method, headers, etc.)
 */
export async function cachedFetch(url: string, ttlSeconds = 60, fetchOpts?: RequestInit): Promise<Response> {
  // Try Cache API (available in Cloudflare Workers, some edge runtimes)
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(CACHE_NAMESPACE);
      const key = cacheKey(url);
      const cached = await cache.match(key);

      if (cached) {
        // Check if cache is still fresh by inspecting date header
        const cachedTime = cached.headers.get("x-cached-at");
        if (cachedTime) {
          const age = (Date.now() - parseInt(cachedTime, 10)) / 1000;
          if (age < ttlSeconds) {
            return cached;
          }
        }
      }

      // Fetch from upstream
      const resp = await fetch(url, fetchOpts);
      if (resp.ok) {
        // Clone and store in cache
        const headers = new Headers(resp.headers);
        headers.set("x-cached-at", String(Date.now()));
        headers.set("x-cache-status", "HIT");

        const body = await resp.arrayBuffer();
        const cachedResp = new Response(body, {
          status: resp.status,
          statusText: resp.statusText,
          headers,
        });

        // Store (ignore errors — caching is best-effort)
        cache.put(key, cachedResp).catch(() => {});

        // Return original response to caller
        return new Response(body, {
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers,
        });
      }

      return resp;
    } catch {
      // Cache API unavailable or error — fall through to direct fetch
    }
  }

  // Fallback: direct fetch
  return fetch(url, fetchOpts);
}

/**
 * Predefined TTL values for common data sources.
 */
export const CACHE_TTL = {
  /** Flights: 15 seconds (high-frequency updates) */
  FLIGHTS: 15,
  /** Military flights: 30 seconds */
  MILITARY: 30,
  /** Earthquakes: 60 seconds */
  EARTHQUAKES: 60,
  /** Weather radar: 120 seconds */
  RADAR: 120,
  /** Weather warnings: 120 seconds */
  WARNINGS: 120,
  /** Vessels: 60 seconds */
  VESSELS: 60,
  /** NLNOG nodes: 3600 seconds (rarely changes) */
  NLNOG: 3600,
  /** Elevation per-coordinate: 86400 seconds (static data) */
  ELEVATION: 86400,
  /** Bathymetry per-coordinate: 86400 seconds (static data) */
  BATHYMETRY: 86400,
  /** Waterways: 3600 seconds (static infrastructure) */
  WATERWAYS: 3600,
  /** Reverse geocode: 86400 seconds (rarely changes) */
  GEOCODE: 86400,
} as const;
