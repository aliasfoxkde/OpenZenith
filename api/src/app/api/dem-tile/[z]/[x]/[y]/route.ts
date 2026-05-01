import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";
import { encodeTerrariumPNG } from "@/lib/terrarium-png";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/**
 * DEM terrain tile endpoint.
 *
 * Serves Terrarium-encoded PNG tiles by assembling them on-the-fly
 * from HuggingFace SRTM 30m chunk datasets.
 *
 * Uses multi-layer caching:
 * 1. Cloudflare Cache API (edge PoP, <10ms)
 * 2. R2 Storage (durable, ~300ms)
 * 3. HuggingFace (origin, ~1000ms)
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
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

// Cache namespace for Cloudflare Cache API (edge-level caching)
const DEM_CACHE_NAMESPACE = "dem-tiles-v1";

/**
 * Get cached tile from Cloudflare Cache API.
 * Returns null on miss or if Cache API unavailable.
 */
async function getCfCacheTile(z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;
  
  try {
    const cache = await caches.open(DEM_CACHE_NAMESPACE);
    const key = `/api/dem-tile/${z}/${x}/${y}`;
    const cached = await cache.match(key);
    
    if (cached) {
      const cachedTime = cached.headers.get("x-cached-at");
      // Cache for 1 hour (same as Cache-Control header)
      if (cachedTime) {
        const age = (Date.now() - parseInt(cachedTime, 10)) / 1000;
        if (age < 3600) {
          return await cached.arrayBuffer();
        }
      } else {
        return await cached.arrayBuffer();
      }
    }
  } catch {
    // Cache API unavailable
  }
  return null;
}

/**
 * Store tile in Cloudflare Cache API for fast edge retrieval.
 */
async function putCfCacheTile(z: number, x: number, y: number, data: ArrayBuffer): Promise<void> {
  if (typeof caches === "undefined") return;
  
  try {
    const cache = await caches.open(DEM_CACHE_NAMESPACE);
    const key = `/api/dem-tile/${z}/${x}/${y}`;
    const headers = new Headers({
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "x-cached-at": String(Date.now()),
      "X-Cache": "HIT",
    });
    cache.put(key, new Response(data, { headers })).catch(() => {});
  } catch {
    // Best-effort caching
  }
}

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

  // Layer 1: Cloudflare Cache API (edge PoP, <10ms)
  try {
    const cfCached = await getCfCacheTile(zoom, tileX, tileY);
    if (cfCached) {
      return new Response(cfCached, {
        headers: {
          ...CACHE_HEADERS,
          "Content-Type": "image/png",
          "Content-Length": String(cfCached.byteLength),
          "X-Dem-Tile-Source": "cf-cache",
          "X-Cache": "HIT",
        },
      });
    }
  } catch {
    // CF Cache unavailable — fall through
  }

  // Layer 2: R2 Storage (~300ms)
  try {
    const cached = await r2GetTile("dem-tile", zoom, tileX, tileY);
    if (cached) {
      // Also store in CF Cache for next request
      putCfCacheTile(zoom, tileX, tileY, cached).catch(() => {});
      
      return new Response(cached, {
        headers: {
          ...CACHE_HEADERS,
          "Content-Type": "image/png",
          "Content-Length": String(cached.byteLength),
          "X-Dem-Tile-Source": "r2-cache",
          "X-Cache": "HIT",
        },
      });
    }
  } catch {
    // R2 unavailable — fall through to generation
  }

  // Assemble tile from HuggingFace chunks
  try {
    const tileData = await getTileData(zoom, tileX, tileY, HF_BACKEND);
    const png = encodeTerrariumPNG(tileData.data, tileData.width, tileData.height);

    // Store in R2 and CF Cache for future requests
    r2PutTile("dem-tile", zoom, tileX, tileY, png.buffer as ArrayBuffer, "image/png").catch(() => {});
    putCfCacheTile(zoom, tileX, tileY, png.buffer as ArrayBuffer).catch(() => {});

    return new Response(png.buffer as ArrayBuffer, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        "X-Dem-Tile-Source": "huggingface",
        "X-Cache": "MISS",
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
