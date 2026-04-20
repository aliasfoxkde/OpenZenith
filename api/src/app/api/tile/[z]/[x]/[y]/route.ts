import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

const TILE_SIZE = 256;

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const zoom = parseInt(z);
  const tileX = parseInt(x);
  const tileY = parseInt(y);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY)) {
    return NextResponse.json({ error: "z, x, y must be integers" }, { status: 400, headers: CORS_HEADERS });
  }

  if (zoom < 0 || zoom > 15) {
    return NextResponse.json({ error: "zoom must be between 0 and 15" }, { status: 400, headers: CORS_HEADERS });
  }

  const maxTile = Math.pow(2, zoom) - 1;
  if (tileX < 0 || tileX > maxTile || tileY < 0 || tileY > maxTile) {
    return NextResponse.json(
      { error: `x,y must be between 0 and ${maxTile} at zoom ${zoom}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // R2 cache-aside
  try {
    const cached = await r2GetTile("dem-raw", zoom, tileX, tileY);
    if (cached) {
      return new NextResponse(cached, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(cached.byteLength),
          "Cache-Control": "public, max-age=3600",
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
    r2PutTile("dem-raw", zoom, tileX, tileY, buffer as ArrayBuffer, "application/octet-stream").catch(() => {});

    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "public, max-age=3600",
        ...CORS_HEADERS,
        "X-Tile-Size": String(TILE_SIZE),
        "X-Zoom": String(zoom),
        "X-Cache": "MISS",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
