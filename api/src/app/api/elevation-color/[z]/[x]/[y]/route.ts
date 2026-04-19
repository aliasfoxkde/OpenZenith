import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { encodeTerrariumPNG } from "@/lib/terrarium-png";
import { zlibSync } from "fflate";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/**
 * Elevation color heatmap tile endpoint.
 *
 * Serves color-ramped elevation tiles by assembling terrain data
 * from HuggingFace SRTM 30m chunks and mapping elevation values
 * to a standard hypsometric color ramp.
 *
 * Tile URL pattern: /api/elevation-color/{z}/{x}/{y}
 * Format: PNG 256x256
 * Colors: deep blue (ocean) → cyan → green → yellow → brown → gray → white (peaks)
 */

const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

export const runtime = "edge";

const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=2592000, s-maxage=2592000",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

// ─── Hypsometric color ramp ───
// Compact: array of [elevation_m, R, G, B] stops
const COLOR_STOPS = [
  [-500, 0, 0, 68],       // deep ocean
  [-100, 8, 48, 107],     // ocean
  [0, 8, 48, 107],        // sea level
  [10, 33, 113, 181],     // coastline
  [50, 103, 169, 207],    // low coast
  [100, 65, 182, 196],    // near-shore transition
  [200, 35, 139, 69],     // lowland green
  [500, 65, 171, 93],     // green hills
  [800, 144, 190, 109],   // rolling
  [1000, 237, 248, 177],  // foothills
  [1500, 255, 237, 160],  // lower mountain
  [2000, 254, 178, 76],   // mountain
  [2500, 253, 141, 60],   // high mountain
  [3000, 240, 59, 32],    // alpine
  [4000, 189, 0, 38],     // very high
  [5000, 128, 0, 0],      // extreme
  [6000, 150, 130, 120],  // rocky peaks
  [7000, 200, 190, 180],  // high peaks
  [8000, 230, 225, 220],  // snow line
  [8849, 255, 255, 255],  // Everest+
];

function lerpColor(elevation: number): [number, number, number] {
  const NODATA = -32768;
  if (elevation === NODATA) return [0, 0, 0];

  // Clamp to ramp range
  const e = Math.max(-500, Math.min(8849, elevation));

  // Find surrounding stops
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [e0, r0, g0, b0] = COLOR_STOPS[i];
    const [e1, r1, g1, b1] = COLOR_STOPS[i + 1];
    if (e >= e0 && e <= e1) {
      if (e1 === e0) return [r0, g0, b0];
      const t = (e - e0) / (e1 - e0);
      return [
        Math.round(r0 + (r1 - r0) * t),
        Math.round(g0 + (g1 - g0) * t),
        Math.round(b0 + (b1 - b0) * t),
      ];
    }
  }

  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  return [last[1], last[2], last[3]];
}

export async function OPTIONS() {
  return corsPreflightResponse();
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

  try {
    const tileData = await getTileData(zoom, tileX, tileY, HF_BACKEND);
    const png = encodeColorPNG(tileData.data, tileData.width, tileData.height);

    return new Response(png.buffer as ArrayBuffer, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        "X-Tile-Type": "elevation-color",
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
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type: RGB

  const ihdr = pngChunk("IHDR", ihdrData);
  const idat = pngChunk("IDAT", compressed);
  const iend = pngChunk("IEND", new Uint8Array(0));

  const result = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  result.set(signature, off); off += signature.length;
  result.set(ihdr, off); off += ihdr.length;
  result.set(idat, off); off += idat.length;
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
