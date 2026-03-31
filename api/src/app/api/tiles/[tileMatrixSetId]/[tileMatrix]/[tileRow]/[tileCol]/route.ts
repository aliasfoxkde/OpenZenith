import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

/**
 * OGC API - Tiles tile data endpoint.
 *
 * Serves terrain elevation tiles in Terrarium PNG encoding.
 * Follows OGC API - Tiles 1.0 path: /tiles/{tileMatrixSetId}/{tileMatrix}/{tileRow}/{tileCol}
 *
 * Maps to internal DEM tile endpoint: /api/dem-tile/{z}/{x}/{y}
 */

export const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
};

export async function OPTIONS() {
  return new Response(null, { headers: CACHE_HEADERS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tileMatrixSetId: string; tileMatrix: string; tileRow: string; tileCol: string }> },
) {
  const { tileMatrixSetId, tileMatrix, tileRow, tileCol } = await params;

  // Validate tile matrix set
  const validSets = ["WebMercatorQuad", "WorldCRS84Quad"];
  if (!validSets.includes(tileMatrixSetId)) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: `Unknown tileMatrixSet: ${tileMatrixSetId}` },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  // Validate zoom level
  const z = parseInt(tileMatrix, 10);
  if (isNaN(z) || z < 0 || z > 10) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: `Invalid tileMatrix (zoom): ${tileMatrix}` },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  // Validate tile coordinates
  const x = parseInt(tileCol, 10);
  const y = parseInt(tileRow, 10);
  if (isNaN(x) || isNaN(y) || x < 0 || y < 0) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: "Invalid tile coordinates" },
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  // Validate tile is within range for this zoom
  const maxTile = Math.pow(2, z) - 1;
  if (x > maxTile || y > maxTile) {
    return NextResponse.json(
      { code: "TileOutOfRange", description: `Tile ${z}/${x}/${y} is out of range` },
      { status: 404, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  // For CRS84, flip Y axis (TMS vs XYZ convention)
  const tmsY = tileMatrixSetId === "WorldCRS84Quad" ? maxTile - y : y;

  try {
    const { env } = getRequestContext();
    const bucket = (env as Record<string, unknown>).DEM_TILES as R2Bucket | undefined;

    if (!bucket) {
      return NextResponse.json(
        { error: "Tile storage not available" },
        { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const tileKey = `tiles/${z}/${x}/${tmsY}.png`;
    const object = await bucket.get(tileKey);

    if (!object) {
      return new Response("Tile not found", {
        status: 404,
        headers: CACHE_HEADERS,
      });
    }

    // Handle Range requests
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      const rangeParts = rangeHeader.replace(/bytes=/, "").split("-");
      const rangeStart = parseInt(rangeParts[0], 10) || 0;
      const rangeEnd = rangeParts[1] ? parseInt(rangeParts[1], 10) : object.size - 1;

      if (rangeStart >= object.size || rangeEnd >= object.size || rangeStart > rangeEnd) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${object.size}`, ...CACHE_HEADERS },
        });
      }

      const contentLength = rangeEnd - rangeStart + 1;
      const body = object.body as ReadableStream;
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let totalRead = 0;

      while (totalRead < rangeStart) {
        const { value, done } = await reader.read();
        if (done) break;
        const skip = Math.min(value.byteLength, rangeStart - totalRead);
        totalRead += skip;
        if (skip < value.byteLength) {
          chunks.push(value.slice(skip));
          totalRead += value.byteLength - skip;
        }
      }

      while (totalRead <= rangeEnd) {
        const { value, done } = await reader.read();
        if (done) break;
        const needed = Math.min(value.byteLength, rangeEnd - totalRead + 1);
        chunks.push(value.slice(0, needed));
        totalRead += needed;
      }

      reader.cancel();

      const combined = new Uint8Array(contentLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      return new Response(combined.buffer, {
        status: 206,
        headers: {
          ...CACHE_HEADERS,
          "Content-Type": "image/png",
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${rangeStart}-${rangeStart + contentLength - 1}/${object.size}`,
          "Accept-Ranges": "bytes",
          "ETag": object.etag || `"${object.size}"`,
        },
      });
    }

    // Full tile response
    return new Response(object.body, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": String(object.size),
        "Accept-Ranges": "bytes",
        "ETag": object.etag || `"${object.size}"`,
      },
    });
  } catch (error) {
    console.error(`OGC Tiles error: ${z}/${x}/${tmsY}`, error);
    return NextResponse.json(
      { error: "Failed to fetch tile" },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}

declare class R2Bucket {
  get(key: string): Promise<R2Object | null>;
}

interface R2Object {
  body: ReadableStream;
  size: number;
  etag: string;
}
