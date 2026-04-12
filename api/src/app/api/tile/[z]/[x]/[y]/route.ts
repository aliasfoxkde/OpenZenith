import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { CORS_HEADERS } from "@/lib/cors";

export const runtime = "edge";

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

const TILE_SIZE = 256;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
      "Access-Control-Max-Age": "86400",
    },
  });
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

  try {
    const result = await getTileData(zoom, tileX, tileY, HF_BACKEND);

    const buffer = result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength);

    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "public, max-age=2592000",
        "Access-Control-Allow-Origin": "*",
        "X-Tile-Size": String(TILE_SIZE),
        "X-Zoom": String(zoom),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
