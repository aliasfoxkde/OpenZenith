/**
 * R2 cache-aside for generated tile data.
 *
 * Tile generation is expensive (~500ms from HuggingFace), but tiles are static
 * for a given zoom/x/y. This module caches generated tiles in R2 so subsequent
 * requests are served from R2 (~10ms) instead of regenerating.
 *
 * Pattern: check R2 → hit? return → miss? generate → store in R2 → return
 *
 * R2 keys: `{type}/{z}/{x}/{y}` (e.g. "elevation-color/10/350/500")
 * R2 values: raw tile bytes (PNG, terrain, etc.)
 * R2 TTL: managed via R2 lifecycle rules (set in CF dashboard)
 */

import { getRequestContext } from "@cloudflare/next-on-pages";

/** R2 bucket type — available in CF Workers runtime. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R2Bucket = any;

/**
 * Get the R2 bucket binding. Returns null if not available (local dev).
 */
function getBucket(): R2Bucket | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = getRequestContext() as any;
    return ctx.env.DEM_TILES as R2Bucket;
  } catch {
    // Not running in CF Pages context (local dev)
    return null;
  }
}

/**
 * Try to get a cached tile from R2.
 * Returns null on miss or if R2 is unavailable.
 */
export async function r2GetTile(type: string, z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  const bucket = getBucket();
  if (!bucket) return null;

  try {
    const key = `${type}/${z}/${x}/${y}`;
    const object = await bucket.get(key);
    if (!object) return null;
    return await object.arrayBuffer();
  } catch {
    // R2 unavailable or error — fall through to generation
    return null;
  }
}

/**
 * Store a generated tile in R2 for future requests.
 * Best-effort — errors are silently ignored.
 */
export async function r2PutTile(
  type: string,
  z: number,
  x: number,
  y: number,
  data: ArrayBuffer | Uint8Array,
  contentType: string = "application/octet-stream",
): Promise<void> {
  const bucket = getBucket();
  if (!bucket) return;

  try {
    const key = `${type}/${z}/${x}/${y}`;
    await bucket.put(key, data, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
        cacheExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      },
    });
  } catch {
    // R2 write failed — tile generation still works, just not cached
  }
}
