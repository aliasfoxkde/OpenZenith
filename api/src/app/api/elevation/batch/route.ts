/**
 * Batch elevation endpoint.
 *
 * Accepts multiple lat/lon points and returns elevations in a single request.
 * Uses R2 Terrarium tiles (same as single-point elevation API).
 *
 * POST /api/elevation/batch
 * Body: { points: [{lat, lon, id?}, ...] }
 * Response: { results: [{lat, lon, elevation, id?}, ...] }
 */

import { NextRequest, NextResponse } from "next/server";
import { decompressSync } from "fflate";

export const runtime = "edge";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface BatchPoint {
  lat: number;
  lon: number;
  id?: string;
}

interface BatchResult {
  id?: string;
  lat: number;
  lon: number;
  elevation: number | null;
}

function latLonToTile(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

interface TileCacheEntry {
  width: number;
  height: number;
  pixels: Uint8Array;
}

declare class R2Bucket {
  get(key: string): Promise<R2Object | null>;
}
interface R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}

function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

function decodePNG(data: Uint8Array): TileCacheEntry | null {
  if (data[0] !== 137 || data[1] !== 80 || data[2] !== 78 || data[3] !== 71 ||
      data[4] !== 13 || data[5] !== 10 || data[6] !== 26 || data[7] !== 10) {
    return null;
  }

  let width = 0, height = 0, colorType = 0;
  const idatChunks: Uint8Array[] = [];
  let offset = 8;

  while (offset < data.length) {
    const len = (data[offset] << 24) | (data[offset+1] << 16) | (data[offset+2] << 8) | data[offset+3];
    offset += 4;
    const type = String.fromCharCode(data[offset], data[offset+1], data[offset+2], data[offset+3]);
    offset += 4;
    const chunkData = data.slice(offset, offset + len);
    if (type === "IHDR") {
      width = (chunkData[0]<<24)|(chunkData[1]<<16)|(chunkData[2]<<8)|chunkData[3];
      height = (chunkData[4]<<24)|(chunkData[5]<<16)|(chunkData[6]<<8)|chunkData[7];
      colorType = chunkData[9];
      if (chunkData[8] !== 8 || (colorType !== 2 && colorType !== 6)) return null;
    } else if (type === "IDAT") {
      idatChunks.push(chunkData);
    } else if (type === "IEND") break;
    offset += len + 4;
  }

  if (!width || !height || !idatChunks.length) return null;

  const totalLen = idatChunks.reduce((s, c) => s + c.length, 0);
  const compressed = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of idatChunks) { compressed.set(c, pos); pos += c.length; }

  let raw: Uint8Array;
  try { raw = decompressSync(compressed); } catch { return null; }

  const bpp = colorType === 2 ? 3 : 4;
  const stride = width * bpp;
  const pixels = new Uint8Array(width * height * 3);
  const prevRow = new Uint8Array(stride);
  let rawOffset = 0;

  for (let y = 0; y < height; y++) {
    const ft = raw[rawOffset++];
    const cur = raw.slice(rawOffset, rawOffset + stride);
    rawOffset += stride;

    for (let i = 0; i < cur.length; i++) {
      switch (ft) {
        case 1: cur[i] = i >= bpp ? (cur[i] + cur[i-bpp]) & 0xFF : cur[i]; break;
        case 2: cur[i] = (cur[i] + prevRow[i]) & 0xFF; break;
        case 3: { const l = i >= bpp ? cur[i-bpp] : 0; cur[i] = (cur[i] + ((l + prevRow[i]) >> 1)) & 0xFF; } break;
        case 4: { const l = i >= bpp ? cur[i-bpp] : 0; const a = prevRow[i]; const u = i >= bpp ? prevRow[i-bpp] : 0;
          const p = l+a-u; const pa = Math.abs(p-l); const pb = Math.abs(p-a); const pc = Math.abs(p-u);
          cur[i] = (cur[i] + (pa<=pb&&pa<=pc?l:pb<=pc?a:u)) & 0xFF; } break;
      }
    }
    for (let x = 0; x < width; x++) {
      const so = x * bpp;
      const d = (y * width + x) * 3;
      pixels[d] = cur[so]; pixels[d+1] = cur[so+1]; pixels[d+2] = cur[so+2];
    }
    prevRow.set(cur);
  }

  return { width, height, pixels };
}

function sampleElevation(png: TileCacheEntry, lat: number, lon: number, zoom: number): number | null {
  const { x, y } = latLonToTile(lat, lon, zoom);
  const n = 2 ** zoom;
  const xFrac = ((lon + 180) / 360) * n - x;
  const latRad = (lat * Math.PI) / 180;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - y;

  const px = xFrac * (png.width - 1);
  const py = yFrac * (png.height - 1);
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, png.width - 1), y1 = Math.min(y0 + 1, png.height - 1);
  const fx = px - x0, fy = py - y0;

  const get = (cx: number, cy: number) => {
    const off = (cy * png.width + cx) * 3;
    return decodeTerrarium(png.pixels[off], png.pixels[off+1], png.pixels[off+2]);
  };

  const h00 = get(x0, y0), h10 = get(x1, y0), h01 = get(x0, y1), h11 = get(x1, y1);
  return h00 * (1-fx) * (1-fy) + h10 * fx * (1-fy) + h01 * (1-fx) * fy + h11 * fx * fy;
}

export async function POST(request: NextRequest) {
  let body: { points?: BatchPoint[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const points = body.points;
  if (!Array.isArray(points) || points.length === 0 || points.length > 2000) {
    return NextResponse.json({ error: "Provide 1-2000 points as {points: [{lat, lon}]}" }, { status: 400, headers: CORS_HEADERS });
  }

  for (const p of points) {
    if (typeof p.lat !== "number" || typeof p.lon !== "number" ||
        isNaN(p.lat) || isNaN(p.lon) || p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) {
      return NextResponse.json({ error: "Each point must have valid lat (-90..90) and lon (-180..180)" }, { status: 400, headers: CORS_HEADERS });
    }
  }

  try {
    const env = process.env as { DEM_TILES?: R2Bucket };
    const bucket = env.DEM_TILES;
    const results: BatchResult[] = [];

    if (!bucket) {
      for (const p of points) {
        results.push({ id: p.id, lat: p.lat, lon: p.lon, elevation: null });
      }
      return NextResponse.json({ results }, { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=60" } });
    }

    const zoom = 8;
    const tileCache = new Map<string, TileCacheEntry | null>();

    // Group points by tile
    const tileGroups = new Map<string, number[]>();
    for (let i = 0; i < points.length; i++) {
      const { x, y } = latLonToTile(points[i].lat, points[i].lon, zoom);
      const key = `${x}/${y}`;
      if (!tileGroups.has(key)) tileGroups.set(key, []);
      tileGroups.get(key)!.push(i);
    }

    // Fetch and decode each unique tile
    for (const [tileKey, indices] of tileGroups) {
      if (!tileCache.has(tileKey)) {
        const object = await bucket.get(`tiles/${zoom}/${tileKey}.png`);
        if (!object) {
          tileCache.set(tileKey, null);
        } else {
          const buf = new Uint8Array(await object.arrayBuffer());
          tileCache.set(tileKey, decodePNG(buf));
        }
      }
      const png = tileCache.get(tileKey);
      for (const idx of indices) {
        const p = points[idx];
        const elevation = png ? sampleElevation(png, p.lat, p.lon, zoom) : null;
        results[idx] = {
          id: p.id,
          lat: p.lat,
          lon: p.lon,
          elevation: elevation !== null ? Math.round(elevation * 10) / 10 : null,
        };
      }
    }

    return NextResponse.json({ results }, { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=60" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
