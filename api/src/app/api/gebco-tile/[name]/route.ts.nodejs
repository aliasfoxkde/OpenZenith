import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { join } from "path";

// Node.js runtime — needed for filesystem access to NAS
export const runtime = "nodejs";

const GEBCO_DIR = "/nas/Temp/DEMs/data/gebco-cog";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  // Validate filename — only allow GEBCO quadrant tile names
  if (!/^gebco_2025_sub_ice_[a-z0-9_.-]+\.tif$/.test(name)) {
    return NextResponse.json(
      { error: "Invalid tile name" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const filePath = join(GEBCO_DIR, name);

  try {
    const fileStat = await stat(filePath);

    // Handle range requests (required for COG)
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            ...CORS_HEADERS,
            "Content-Range": `bytes */${fileStat.size}`,
          },
        });
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileStat.size - 1;

      if (start >= fileStat.size || end >= fileStat.size || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            ...CORS_HEADERS,
            "Content-Range": `bytes */${fileStat.size}`,
          },
        });
      }

      const contentLength = end - start + 1;
      const stream = createReadStream(filePath, { start, end });

      return new NextResponse(stream as unknown as BodyInit, {
        status: 206,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "image/tiff",
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    // Full file request
    const stream = createReadStream(filePath);

    return new NextResponse(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "image/tiff",
        "Content-Length": String(fileStat.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Tile not found" },
      { status: 404, headers: CORS_HEADERS },
    );
  }
}
