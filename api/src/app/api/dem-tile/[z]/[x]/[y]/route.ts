import { NextRequest, NextResponse } from "next/server";
import { zlibSync } from "fflate";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";

/**
 * DEM terrain tile endpoint.
 *
 * Serves Terrarium-encoded PNG tiles by assembling them on-the-fly
 * from HuggingFace SRTM 30m chunk datasets.
 *
 * Used by CesiumJS terrain provider and MapLibre raster-dem source.
 *
 * Tile URL pattern: /api/dem-tile/{z}/{x}/{y}
 * Format: Terrarium PNG (256x256)
 * Encoding: height_m = (R * 256 + G + B / 256) - 32768
 */

// Direct backend instance — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

export const runtime = "edge";

// Cache headers for immutable terrain tiles
const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=86400, s-maxage=86400",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

export async function OPTIONS() {
  return new Response(null, { headers: CACHE_HEADERS });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await params;

  // Strip .png extension from y parameter (Next.js includes it in the catch-all)
  const tileYStr = y.replace(/\.png$/, "");

  // Validate zoom level
  const zoom = parseInt(z, 10);
  if (isNaN(zoom) || zoom < 0 || zoom > 14) {
    return NextResponse.json(
      { error: "Invalid zoom level" },
      { status: 400 },
    );
  }

  // Validate tile coordinates
  const tileX = parseInt(x, 10);
  const tileY = parseInt(tileYStr, 10);
  if (isNaN(tileX) || isNaN(tileY)) {
    return NextResponse.json(
      { error: "Invalid tile coordinates" },
      { status: 400 },
    );
  }

  // Assemble tile from HuggingFace chunks
  try {
    const tileData = await getTileData(zoom, tileX, tileY, HF_BACKEND);
    const png = encodeTerrariumPNG(tileData.data, tileData.width, tileData.height);

    return new Response(png.buffer as ArrayBuffer, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        "X-Dem-Tile-Source": "huggingface",
      },
    });
  } catch (error) {
    console.error(`DEM tile assembly error: ${zoom}/${tileX}/${tileY}`, error);
    // Return ocean tile for out-of-coverage or errors
    const oceanPng = encodeTerrariumPNG(new Int16Array(256 * 256), 256, 256);
    return new Response(oceanPng.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "X-Dem-Tile-Source": "fallback-ocean",
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Terrarium PNG encoder (edge-compatible)
// ---------------------------------------------------------------------------

/**
 * Encode an Int16Array elevation grid as a 256x256 Terrarium PNG.
 * Terrarium: height_m = (R * 256 + G + B / 256) - 32768
 */
function encodeTerrariumPNG(data: Int16Array, width: number, height: number): Uint8Array {
  // Build raw scanlines: filter byte (0 = None) + RGB per pixel
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let py = 0; py < height; py++) {
    const rowOff = py * (1 + width * 3);
    raw[rowOff] = 0; // filter = None
    for (let px = 0; px < width; px++) {
      const elev = data[py * width + px];
      const enc = elev + 32768; // 0..65535
      const pixOff = rowOff + 1 + px * 3;
      raw[pixOff] = (enc >> 8) & 0xFF;     // R
      raw[pixOff + 1] = enc & 0xFF;        // G
      raw[pixOff + 2] = 0;                  // B (integer elevations have no sub-meter component)
    }
  }

  const compressed = zlibSync(raw, { level: 1 }); // zlib-wrapped deflate for PNG IDAT

  // Assemble PNG
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type RGB

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
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

