import { NextRequest, NextResponse } from "next/server";

/**
 * DEM terrain tile endpoint.
 *
 * Serves Terrarium-encoded PNG tiles from Cloudflare R2.
 * Used by CesiumJS terrain provider and MapLibre raster-dem source.
 *
 * Tile URL pattern: /api/dem-tile/{z}/{x}/{y}
 * Format: Terrarium PNG (256x256)
 * Encoding: height_m = (R * 256 + G + B / 256) - 32768
 */

export const runtime = "edge";

// Cache headers for immutable terrain tiles
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
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

  // Validate zoom level (we only generate up to zoom 12)
  const zoom = parseInt(z, 10);
  if (isNaN(zoom) || zoom < 0 || zoom > 14) {
    return NextResponse.json(
      { error: "Invalid zoom level" },
      { status: 400 },
    );
  }

  // Validate tile coordinates
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);
  if (isNaN(tileX) || isNaN(tileY)) {
    return NextResponse.json(
      { error: "Invalid tile coordinates" },
      { status: 400 },
    );
  }

  // Get R2 bucket from env bindings
  const env = process.env as { DEM_TILES?: R2Bucket };
  const bucket = env.DEM_TILES;

  if (!bucket) {
    // Fallback: return a flat ocean tile (elevation = 0)
    return new Response(generateFlatTile(0).buffer as ArrayBuffer, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "X-Dem-Tile-Source": "fallback-flat",
      },
    });
  }

  const key = `tiles/${z}/${x}/${y}.png`;

  try {
    const object = await bucket.get(key);

    if (!object) {
      // Return flat ocean tile for missing tiles
      return new Response(generateFlatTile(-100).buffer as ArrayBuffer, {
        headers: {
          ...CACHE_HEADERS,
          "Content-Type": "image/png",
          "X-Dem-Tile-Source": "fallback-missing",
        },
      });
    }

    return new Response(object.body, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": String(object.size),
        "ETag": object.etag || "",
        "X-Dem-Tile-Source": "r2",
      },
    });
  } catch (error) {
    console.error(`DEM tile error: ${key}`, error);
    return new Response(generateFlatTile(-100).buffer as ArrayBuffer, {
      status: 200,
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "X-Dem-Tile-Source": "fallback-error",
      },
    });
  }
}

/**
 * Generate a minimal flat PNG tile with a constant elevation.
 * Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768
 */
function generateFlatTile(elevation_m: number): Uint8Array {
  const enc = Math.max(0, Math.min(65535, elevation_m + 32768));
  const r = Math.min(255, Math.floor(enc / 256));
  const g = Math.floor(enc % 256);
  const b = Math.floor((enc * 256) % 256);

  // Minimal valid PNG (1x1 pixel, uncompressed)
  // For a proper 256x256 tile we'd need a real PNG encoder,
  // but for fallback a small one is fine
  return createMinimalPNG(r, g, b);
}

/**
 * Create a minimal 1x1 PNG with the given RGB color.
 * This is used as a fallback when R2 is not available.
 */
function createMinimalPNG(r: number, g: number, b: number): Uint8Array {
  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk (1x1, 8-bit RGB)
  const ihdrData = new Uint8Array(13);
  ihdrData[0] = 0; // width high byte
  ihdrData[1] = 1; // width low byte
  ihdrData[2] = 0; // height high byte
  ihdrData[3] = 1; // height low byte
  ihdrData[4] = 8; // bit depth
  ihdrData[5] = 2; // color type (RGB)
  // rest is zeros (compression, filter, interlace)
  const ihdr = createChunk("IHDR", ihdrData);

  // IDAT chunk (compressed pixel data: filter byte 0 + RGB)
  const rawData = new Uint8Array([0, r, g, b]); // filter=none + RGB
  const idat = createChunk("IDAT", deflateSync(rawData));

  // IEND chunk
  const iend = createChunk("IEND", new Uint8Array(0));

  // Concatenate
  const total = signature.length + ihdr.length + idat.length + iend.length;
  const result = new Uint8Array(total);
  let offset = 0;
  result.set(signature, offset); offset += signature.length;
  result.set(ihdr, offset); offset += ihdr.length;
  result.set(idat, offset); offset += idat.length;
  result.set(iend, offset);

  return result;
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const length = data.length;
  const typeBytes = new TextEncoder().encode(type);
  const crcData = new Uint8Array(typeBytes.length + data.length);
  crcData.set(typeBytes);
  crcData.set(data, typeBytes.length);
  const crc = crc32(crcData);

  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, length); // length (big-endian)
  chunk.set(typeBytes, 4);  // type
  chunk.set(data, 8);        // data
  view.setUint32(8 + data.length, crc); // CRC (big-endian)
  return chunk;
}

function deflateSync(data: Uint8Array): Uint8Array {
  // Minimal deflate wrapper - store block (no compression)
  // This is valid DEFLATE format
  const cmf = 0x78; // CM=8 (deflate), CINFO=7 (32K window)
  const flg = 0x01; // FCHECK makes (CMF*256+FLG) divisible by 31

  const maxBlock = 65535;
  const blocks: Uint8Array[] = [];

  let offset = 0;
  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockSize = Math.min(remaining, maxBlock);
    const isFinal = offset + blockSize >= data.length;

    // Block header: BFINAL + BTYPE=00 (stored)
    const header = new Uint8Array(5);
    header[0] = isFinal ? 1 : 0; // BFINAL
    header[1] = 0; // BTYPE=00 (no compression)
    header[2] = blockSize & 0xFF; // LEN
    header[3] = (blockSize >> 8) & 0xFF; // NLEN
    header[4] = (~blockSize) & 0xFF; // NLEN (complement)

    const block = new Uint8Array(5 + blockSize);
    block.set(header);
    block.set(data.slice(offset, offset + blockSize), 5);
    blocks.push(block);
    offset += blockSize;
  }

  // Combine: CMF + FLG + blocks + Adler32
  const blockData = new Uint8Array(blocks.reduce((s, b) => s + b.length, 0));
  let off = 0;
  for (const b of blocks) {
    blockData.set(b, off);
    off += b.length;
  }

  const adler = adler32(data);
  const result = new Uint8Array(2 + blockData.length + 4);
  result[0] = cmf;
  result[1] = flg;
  result.set(blockData, 2);
  const view = new DataView(result.buffer);
  view.setUint32(2 + blockData.length, adler, false); // big-endian
  return result;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Cloudflare R2 bucket type
declare class R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: ArrayBuffer | ReadableStream, options?: R2PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

interface R2Object {
  body: ReadableStream;
  size: number;
  etag: string;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

interface R2PutOptions {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

interface R2Objects {
  objects: Array<{
    key: string;
    size: number;
    etag: string;
  }>;
  truncated: boolean;
  cursor?: string;
}

interface R2ListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
  include?: Array<"httpMetadata" | "customMetadata">;
}
