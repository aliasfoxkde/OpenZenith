import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { encodeTerrariumPNG } from "@/lib/terrarium-png";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

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

// Cache headers — tiles are deterministic, cache aggressively
const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=2592000, s-maxage=2592000",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;

  // Strip .png extension from y parameter (Next.js includes it in the catch-all)
  const tileYStr = y.replace(/\.png$/, "");

  // Validate zoom level
  const zoom = parseInt(z, 10);
  if (isNaN(zoom) || zoom < 0 || zoom > 14) {
    return NextResponse.json({ error: "Invalid zoom level" }, { status: 400, headers: CORS_HEADERS });
  }

  // Validate tile coordinates
  const tileX = parseInt(x, 10);
  const tileY = parseInt(tileYStr, 10);
  if (isNaN(tileX) || isNaN(tileY)) {
    return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400, headers: CORS_HEADERS });
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
