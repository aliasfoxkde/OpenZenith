import { NextRequest, NextResponse } from "next/server";
import { zlibSync } from "fflate";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";

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
  "Cache-Control": "public, max-age=86400, s-maxage=86400",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

export async function OPTIONS() {
  return new Response(null, { headers: CACHE_HEADERS });
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
      { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  // Validate zoom level
  const z = parseInt(tileMatrix, 10);
  if (isNaN(z) || z < 0 || z > 14) {
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

// ---------------------------------------------------------------------------
// Terrarium PNG encoder (edge-compatible, duplicated from dem-tile route)
// ---------------------------------------------------------------------------

function encodeTerrariumPNG(data: Int16Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let py = 0; py < height; py++) {
    const rowOff = py * (1 + width * 3);
    raw[rowOff] = 0;
    for (let px = 0; px < width; px++) {
      const elev = data[py * width + px];
      const enc = elev + 32768;
      const pixOff = rowOff + 1 + px * 3;
      raw[pixOff] = (enc >> 8) & 0xFF;
      raw[pixOff + 1] = enc & 0xFF;
      raw[pixOff + 2] = 0;
    }
  }

  const compressed = zlibSync(raw, { level: 1 });

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdrData[8] = 8;
  ihdrData[9] = 2;

  const ihdr = pngChunk("IHDR", ihdrData);
  const idat = pngChunk("IDAT", compressed);
  const iend = pngChunk("IEND", new Uint8Array(0));

  const result = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  result.set(signature, off); off += signature.length;
  result.set(ihdr, off); off += ihdr.length;
  result.set(idat, off); off += idat.length;
  result.set(iend, off);
  return result;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);

  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(crcInput));
  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
