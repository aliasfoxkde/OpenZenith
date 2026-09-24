import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { r2GetTile, r2PutTile, RENDER_SCHEMA_VERSION } from "@/lib/storage/r2-tile-cache";
import { lerpColor } from "@/lib/hypsometric";
import { zlibSync } from "fflate";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

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

export const runtime = "edge";

const CACHE_TTL_SECONDS = 3600;
const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
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
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
      "x-cached-at": String(Date.now()),
    });
    cache.put(key, new Response(data, { headers })).catch(() => {});
  } catch {
    // Best-effort
  }
}

// Preflight has nothing to await — stay promise-returning because callers await handlers.
export function OPTIONS() {
  return Promise.resolve(corsPreflightResponse());
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;

  const tileYStr = y.replace(/\.png$/, "");
  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(tileYStr, 10);

  if (isNaN(zoom) || zoom < 0 || zoom > 14 || isNaN(tileX) || isNaN(tileY)) {
    return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400, headers: CORS_HEADERS });
  }

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
    const cached = await r2GetTile("elevation-color", zoom, tileX, tileY);
    if (cached) {
      // Also store in CF Cache
      putEcCfCache(zoom, tileX, tileY, cached).catch(() => {});

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

    // Store in R2 and CF Cache
    r2PutTile("elevation-color", zoom, tileX, tileY, png.buffer as ArrayBuffer, "image/png").catch(() => {});
    putEcCfCache(zoom, tileX, tileY, png.buffer as ArrayBuffer).catch(() => {});

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
      const elev = data[py * width + px];
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

  const compressed = zlibSync(raw, { level: 1 });
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB

  const ihdr = pngChunk("IHDR", ihdrData);
  const idat = pngChunk("IDAT", compressed);
  const iend = pngChunk("IEND", new Uint8Array(0));

  const result = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  result.set(signature, off);
  off += signature.length;
  result.set(ihdr, off);
  off += ihdr.length;
  result.set(idat, off);
  off += idat.length;
  result.set(iend, off);
  return result;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);

  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(crcInput));
  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
