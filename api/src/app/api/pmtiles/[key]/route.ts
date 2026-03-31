/**
 * PMTiles serving endpoint.
 *
 * Serves PMTiles files from R2 with HTTP Range request support.
 * MapLibre GL JS v5+ has native PMTiles protocol support via
 * the pmtiles:// protocol handler.
 *
 * Usage: /api/pmtiles/{key}
 * Example: /api/pmtiles/terrain
 */

import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
};

export async function OPTIONS() {
  return new Response(null, { headers: CACHE_HEADERS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const sanitizedKey = key.replace(/\.\./g, "").replace(/\//g, "");

  const { env } = getRequestContext();
  const bucket = (env as Record<string, unknown>).DEM_TILES as R2Bucket | undefined;

  if (!bucket) {
    return NextResponse.json(
      { error: "Storage not available" },
      { status: 503 },
    );
  }

  const pmtilesKey = `pmtiles/${sanitizedKey}.pmtiles`;

  try {
    const object = await bucket.get(pmtilesKey);

    if (!object) {
      return NextResponse.json(
        { error: "PMTiles file not found", available: [] },
        { status: 404 },
      );
    }

    const size = object.size;

    // Handle Range requests (essential for PMTiles protocol)
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      const rangeParts = rangeHeader.replace(/bytes=/, "").split("-");
      const rangeStart = parseInt(rangeParts[0], 10) || 0;
      const rangeEnd = rangeParts[1]
        ? parseInt(rangeParts[1], 10)
        : size - 1;

      if (rangeStart >= size || rangeEnd >= size || rangeStart > rangeEnd) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }

      const contentLength = rangeEnd - rangeStart + 1;

      // Get a ranged read from R2
      const body = object.body as ReadableStream;
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let totalRead = 0;

      // Skip to rangeStart
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

      // Read until rangeEnd
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
          "Content-Type": "application/octet-stream",
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${rangeStart}-${rangeStart + contentLength - 1}/${size}`,
          "Accept-Ranges": "bytes",
          "ETag": object.etag || `"${size}"`,
        },
      });
    }

    // Full file response
    return new Response(object.body, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "ETag": object.etag || `"${size}"`,
      },
    });
  } catch (error) {
    console.error(`PMTiles error: ${pmtilesKey}`, error);
    return NextResponse.json(
      { error: "Failed to fetch PMTiles file" },
      { status: 500 },
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
