import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { edgeGetTile, edgePutTile, RENDER_SCHEMA_VERSION } from "@/lib/storage/edge-cache";
import { lerpColor } from "@/lib/hypsometric";
import { assembleRgbPng } from "@/lib/rgb-png";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { parseTileParams } from "@/lib/tile-params";

/**
 * Elevation color heatmap tile endpoint.
 *
 * Serves color-ramped elevation tiles by assembling terrain data
 * from HuggingFace SRTM 30m chunks and mapping elevation values
 * to a standard hypsometric color ramp.
 *
 * Uses multi-layer caching:
 * 1. Cloudflare Cache API (edge PoP, <10ms)
 * 2. R2 Storage (durable, ~300ms)
 * 3. HuggingFace (origin, ~1000ms)
 *
 * Tile URL pattern: /api/elevation-color/{z}/{x}/{y}
 * Format: PNG 256x256
 * Colors: deep blue (ocean) → cyan → green → yellow → brown → gray → white (peaks)
 */

const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

/** Marks the route for the Cloudflare edge runtime (Workers) instead of the Node.js server runtime. */
export const runtime = "edge";

// Immutable for a given render schema — same policy as /api/dem-tile.
const CACHE_TTL_SECONDS = 31536000;
const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, immutable`,
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

// The hypsometric ramp and its lerpColor mapper live in @/lib/hypsometric —
// Next.js route modules may only export route handlers and config.

// Cloudflare Cache API namespace for elevation-color tiles. Derived from
// RENDER_SCHEMA_VERSION so a decode/render change orphans previously cached
// edge renders instead of serving them (same salt as the R2 keys).
const EC_CACHE_NAMESPACE = `elevation-color-v${RENDER_SCHEMA_VERSION}`;

/**
 * Get cached tile from Cloudflare Cache API.
 */
async function getEcCfCache(z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;

  try {
    const cache = await caches.open(EC_CACHE_NAMESPACE);
    const key = `/api/elevation-color/${z}/${x}/${y}`;
    const cached = await cache.match(key);

    if (cached) {
      const cachedTime = cached.headers.get("x-cached-at");
      if (cachedTime) {
        const age = (Date.now() - parseInt(cachedTime, 10)) / 1000;
        if (age < CACHE_TTL_SECONDS) {
          return await cached.arrayBuffer();
        }
      }
      // No timestamp → write age unknown → treat as expired and re-render
      // rather than serve bytes of unbounded staleness.
    }
  } catch {
    // Cache API unavailable
  }
  return null;
}

/**
 * Store tile in Cloudflare Cache API.
 */
async function putEcCfCache(z: number, x: number, y: number, data: ArrayBuffer): Promise<void> {
  if (typeof caches === "undefined") return;

  try {
    const cache = await caches.open(EC_CACHE_NAMESPACE);
    const key = `/api/elevation-color/${z}/${x}/${y}`;
    const headers = new Headers({
      "Content-Type": "image/png",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, immutable`,
      "x-cached-at": String(Date.now()),
    });
    cache.put(key, new Response(data, { headers })).catch(() => {});
  } catch {
    // Best-effort
  }
}

// Preflight has nothing to await — stay promise-returning because callers await handlers.
/**
 * CORS preflight handler for the elevation color tile endpoint: answers the
 * browser's OPTIONS probe with the allowed-origin headers and an empty body.
 */
export function OPTIONS() {
  return Promise.resolve(corsPreflightResponse());
}

/**
 * GET handler for a hypsometric elevation color tile.
 *
 * Reads the `z`/`x`/`y` route segments (a `.png` suffix on the row is
 * stripped) and validates them against zoom 0..14. The tile is assembled from
 * the HuggingFace SRTM chunk backend and each elevation sample is mapped
 * through the hypsometric ramp (deep blue ocean through cyan, green, yellow,
 * brown and gray to white at the peaks); NoData pixels are painted dark blue.
 *
 * Tiles are served through three layers — the Cloudflare Cache API, the
 * durable edge tile store, then generation from the origin — and are immutable
 * for one year. If assembly fails the route still answers 200 with a flat
 * ocean-colored fallback tile marked `X-Tile-Type: fallback-ocean`.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;

  const tileYStr = y.replace(/\.png$/, "");
  const parsed = parseTileParams(z, x, tileYStr, { minZoom: 0, maxZoom: 14 });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: parsed.status, headers: CORS_HEADERS });
  }
  const { z: zoom, x: tileX, y: tileY } = parsed;

  // Layer 1: Cloudflare Cache API (<10ms)
  try {
    const cfCached = await getEcCfCache(zoom, tileX, tileY);
    if (cfCached) {
      return new Response(cfCached, {
        headers: {
          ...CACHE_HEADERS,
          "Content-Type": "image/png",
          "Content-Length": String(cfCached.byteLength),
          "X-Tile-Type": "elevation-color",
          "X-Cache": "HIT",
        },
      });
    }
  } catch {
    // CF Cache unavailable — fall through
  }

  // Layer 2: R2 Storage (~300ms)
  try {
    const cached = await edgeGetTile("elevation-color", zoom, tileX, tileY);
    if (cached) {
      // Also store in CF Cache. putEcCfCache resolves on every path (its own
      // try/catch swallows all failures), so no rejection guard is needed.
      void putEcCfCache(zoom, tileX, tileY, cached);

      return new Response(cached, {
        headers: {
          ...CACHE_HEADERS,
          "Content-Type": "image/png",
          "Content-Length": String(cached.byteLength),
          "X-Tile-Type": "elevation-color",
          "X-Cache": "HIT",
        },
      });
    }
  } catch {
    // R2 unavailable — fall through to generation
  }

  try {
    const tileData = await getTileData(zoom, tileX, tileY, HF_BACKEND);
    const png = encodeColorPNG(tileData.data, tileData.width, tileData.height);

    // Store in R2 and CF Cache. edgePutTile's mock-real contract rejects only
    // on transport failure — the response is already committed, so the
    // rejection is deliberately dropped; putEcCfCache never rejects.
    edgePutTile("elevation-color", zoom, tileX, tileY, png.buffer as ArrayBuffer, "image/png").catch(() => {});
    void putEcCfCache(zoom, tileX, tileY, png.buffer as ArrayBuffer);

    return new Response(png.buffer as ArrayBuffer, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        "X-Tile-Type": "elevation-color",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error(`Elevation color tile error: ${zoom}/${tileX}/${tileY}`, error);
    // Return ocean color tile
    const oceanPng = encodeColorPNG(new Int16Array(256 * 256), 256, 256);
    return new Response(oceanPng.buffer as ArrayBuffer, {
      status: 200,
      headers: { ...CACHE_HEADERS, "Content-Type": "image/png", "X-Tile-Type": "fallback-ocean" },
    });
  }
}

/**
 * Encode elevation data as a color-ramped PNG.
 * Similar structure to encodeTerrariumPNG but outputs RGB color ramp.
 */
function encodeColorPNG(data: Int16Array, width: number, height: number): Uint8Array {
  const NODATA = -32768;
  const raw = new Uint8Array(height * (1 + width * 3));

  for (let py = 0; py < height; py++) {
    const rowOff = py * (1 + width * 3);
    raw[rowOff] = 0; // PNG filter: None

    for (let px = 0; px < width; px++) {
      // bounds: py < height and px < width, so the row-major index is < data.length
      const elev = data[py * width + px]!;
      const pixOff = rowOff + 1 + px * 3;

      if (elev === NODATA) {
        // NoData → transparent dark blue (ocean/unknown)
        raw[pixOff] = 5;
        raw[pixOff + 1] = 12;
        raw[pixOff + 2] = 30;
      } else {
        const [r, g, b] = lerpColor(elev);
        raw[pixOff] = r;
        raw[pixOff + 1] = g;
        raw[pixOff + 2] = b;
      }
    }
  }

  // Shared PNG container (cycle V, C2): zlib + IHDR/IDAT/IEND assembly lives
  // in rgb-png.ts alone; this route owns only its pixel-fill loop above.
  return assembleRgbPng(raw, width, height);
}
