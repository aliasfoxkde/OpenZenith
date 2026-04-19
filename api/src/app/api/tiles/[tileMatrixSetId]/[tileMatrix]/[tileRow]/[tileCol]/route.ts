import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { encodeTerrariumPNG } from "@/lib/terrarium-png";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

/**
 * OGC API - Tiles tile data endpoint.
 *
 * Serves terrain elevation tiles in Terrarium PNG encoding.
 * Assembles tiles on-the-fly from HuggingFace SRTM 30m chunk datasets.
 *
 * Follows OGC API - Tiles 1.0 path: /tiles/{tileMatrixSetId}/{tileMatrix}/{tileRow}/{tileCol}
 */

const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=3600, s-maxage=2592000",
  ...CORS_HEADERS,
};

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tileMatrixSetId: string; tileMatrix: string; tileRow: string; tileCol: string }> },
) {
  const { tileMatrixSetId, tileMatrix, tileRow, tileCol } = await params;

  // Validate tile matrix set
  const validSets = ["WebMercatorQuad", "WorldCRS84Quad"];
  if (!validSets.includes(tileMatrixSetId)) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: `Unknown tileMatrixSet: ${tileMatrixSetId}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate zoom level
  const z = parseInt(tileMatrix, 10);
  if (isNaN(z) || z < 0 || z > 14) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: `Invalid tileMatrix (zoom): ${tileMatrix}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate tile coordinates
  const x = parseInt(tileCol, 10);
  const y = parseInt(tileRow, 10);
  if (isNaN(x) || isNaN(y) || x < 0 || y < 0) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: "Invalid tile coordinates" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate tile is within range for this zoom
  const maxTile = Math.pow(2, z) - 1;
  if (x > maxTile || y > maxTile) {
    return NextResponse.json(
      { code: "TileOutOfRange", description: `Tile ${z}/${x}/${y} is out of range` },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  // For CRS84, flip Y axis (TMS vs XYZ convention)
  const tmsY = tileMatrixSetId === "WorldCRS84Quad" ? maxTile - y : y;

  try {
    const tileData = await getTileData(z, x, tmsY, HF_BACKEND);
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
    console.error(`OGC Tiles assembly error: ${z}/${x}/${tmsY}`, error);

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
