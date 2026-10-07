/**
 * Raw DEM elevation tile endpoint (Terrarium-compatible 256x256 Int16 grid).
 *
 * GET /api/tile/{z}/{x}/{y} - application/octet-stream, zooms 0-15, sourced
 * from the HuggingFace merged SRTM chunks. Caching: Workers Cache API under
 * prefix "dem-raw", then Cache-Control: public, max-age=31536000, immutable
 * (tile content is fixed per zoom/x/y), with X-Tile-Size, X-Zoom and
 * X-Cache: HIT|MISS markers. For rendered terrain tiles use
 * /api/dem-tile/{z}/{x}/{y}.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { edgeGetTile, edgePutTile } from "@/lib/storage/edge-cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { parseTileParams } from "@/lib/tile-params";

export const runtime = "edge";

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

const TILE_SIZE = 256;

export function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const parsed = parseTileParams(z, x, y, { minZoom: 0, maxZoom: 15 });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: parsed.status, headers: CORS_HEADERS });
  }
  const { z: zoom, x: tileX, y: tileY } = parsed;

  // R2 cache-aside
  try {
    const cached = await edgeGetTile("dem-raw", zoom, tileX, tileY);
    if (cached) {
      return new NextResponse(cached, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(cached.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable",
          ...CORS_HEADERS,
          "X-Tile-Size": String(TILE_SIZE),
          "X-Zoom": String(zoom),
          "X-Cache": "HIT",
        },
      });
    }
  } catch {
    // R2 unavailable
  }

  try {
    const result = await getTileData(zoom, tileX, tileY, HF_BACKEND);

    const buffer = result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength);

    // Store in R2
    edgePutTile("dem-raw", zoom, tileX, tileY, buffer as ArrayBuffer, "application/octet-stream").catch(() => {});

    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        ...CORS_HEADERS,
        "X-Tile-Size": String(TILE_SIZE),
        "X-Zoom": String(zoom),
        "X-Cache": "MISS",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Assembly failures are upstream/infrastructure errors: a 200 octet-stream
    // body of JSON would poison every binary decoder downstream.
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
