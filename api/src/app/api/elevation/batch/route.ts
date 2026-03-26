/**
 * Batch elevation endpoint.
 *
 * Accepts multiple lat/lon points and returns elevations in a single request.
 * Key optimization: groups points by SRTM tile+chunk, fetches each chunk only once.
 * A 20x20 grid (400 points) typically hits only 4-9 unique chunks,
 * reducing 400 sequential HTTP fetches to 4-9 chunk fetches.
 *
 * POST /api/elevation/batch
 * Body: { points: [{lat, lon, id?}, ...] }
 * Response: { results: [{lat, lon, elevation, id?}, ...] }
 */

import { NextRequest, NextResponse } from "next/server";
import { decompressSync } from "fflate";
import {
  latLonToSrtmName,
  srtmNameToBounds,
  latLonToPixel,
  isWithinSRTM,
} from "@/lib/srtm/tile-math";
import { getDefaultBackend } from "@/lib/storage/backend";
import { cacheGet, cachePut } from "@/lib/storage/cache";
import { getCopernicusElevation } from "@/lib/copernicus/cog-reader";

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

const NODATA = -32768;

/** Per-request chunk cache to deduplicate fetches within a batch. */
type ChunkData = { data: Int16Array; chunkWidth: number; chunkHeight: number };

/**
 * Fetch, decompress, and cache a single SRTM chunk.
 * Returns null if the chunk is not available.
 */
async function fetchChunk(
  srtmName: string,
  chunkRow: number,
  chunkCol: number,
  storage: ReturnType<typeof getDefaultBackend>,
  chunkCache: Map<string, ChunkData>,
): Promise<ChunkData | null> {
  const cacheKey = `oz:chunk:${srtmName}:${chunkRow}:${chunkCol}`;

  // Check request-level cache first
  const hit = chunkCache.get(cacheKey);
  if (hit) return hit;

  // Check persistent cache (Cloudflare Cache API or in-memory)
  let compressed = await cacheGet(cacheKey);
  if (!compressed) {
    try {
      compressed = await storage.fetchChunk(srtmName, chunkRow, chunkCol);
      await cachePut(cacheKey, compressed);
    } catch {
      return null;
    }
  }

  // Decompress
  const raw = decompressSync(new Uint8Array(compressed));
  const tilesAcross = 15;
  const tilesDown = 15;
  const cw = chunkCol < tilesAcross - 1 ? 256 : 3601 - (tilesAcross - 1) * 256;
  const ch = chunkRow < tilesDown - 1 ? 256 : 3601 - (tilesDown - 1) * 256;
  const pixels = cw * ch;
  const rawData = new Int16Array(raw.buffer, raw.byteOffset, pixels);

  // Undo TIFF horizontal predictor (predictor=2)
  const data = new Int16Array(pixels);
  for (let r = 0; r < ch; r++) {
    const off = r * cw;
    data[off] = rawData[off];
    for (let c = 1; c < cw; c++) {
      data[off + c] = data[off + c - 1] + rawData[off + c];
    }
  }

  const result: ChunkData = { data, chunkWidth: cw, chunkHeight: ch };
  chunkCache.set(cacheKey, result);
  return result;
}

/** Read a pixel value from a decompressed chunk, returning null for OOB/nodata. */
function pixel(chunk: ChunkData, r: number, c: number): number | null {
  if (r < 0 || r >= chunk.chunkHeight || c < 0 || c >= chunk.chunkWidth) return null;
  const v = chunk.data[r * chunk.chunkWidth + c];
  return v === NODATA ? null : v;
}

export async function POST(request: NextRequest) {
  let body: { points?: BatchPoint[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const points = body.points;
  if (!Array.isArray(points) || points.length === 0 || points.length > 2000) {
    return NextResponse.json(
      { error: "Provide 1-2000 points as {points: [{lat, lon}]}" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  for (const p of points) {
    if (
      typeof p.lat !== "number" ||
      typeof p.lon !== "number" ||
      isNaN(p.lat) ||
      isNaN(p.lon) ||
      p.lat < -90 ||
      p.lat > 90 ||
      p.lon < -180 ||
      p.lon > 180
    ) {
      return NextResponse.json(
        { error: "Each point must have valid lat (-90..90) and lon (-180..180)" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
  }

  try {
    const storage = getDefaultBackend();
    const chunkCache = new Map<string, ChunkData>();
    const results: BatchResult[] = [];
    const copernicusIndices: number[] = [];

    // ── Phase 1: Compute tile/chunk/pixel for each point ──
    const meta = points.map((p, i) => {
      const srtmName = latLonToSrtmName(p.lat, p.lon);
      const bounds = srtmNameToBounds(srtmName);
      const { row, col } = latLonToPixel(p.lat, p.lon, bounds);
      return {
        srtmName,
        bounds,
        chunkRow: Math.floor(row / 256),
        chunkCol: Math.floor(col / 256),
        localRow: row % 256,
        localCol: col % 256,
        inSRTM: isWithinSRTM(p.lat, p.lon),
        idx: i,
      };
    });

    // ── Phase 2: Batch SRTM lookups ──
    for (const m of meta) {
      if (!m.inSRTM) {
        copernicusIndices.push(m.idx);
        // Placeholder — may be overwritten by Copernicus fallback below
        results.push({ id: points[m.idx].id, lat: points[m.idx].lat, lon: points[m.idx].lon, elevation: null });
        continue;
      }

      const chunk = await fetchChunk(m.srtmName, m.chunkRow, m.chunkCol, storage, chunkCache);
      if (!chunk) {
        results.push({ id: points[m.idx].id, lat: points[m.idx].lat, lon: points[m.idx].lon, elevation: null });
        continue;
      }

      // Bilinear interpolation (same as single-point getElevation)
      const p = points[m.idx];
      const exactRow = (m.bounds.latMax - p.lat) * 3600;
      const exactCol = (p.lon - m.bounds.lonMin) * 3600;
      const fracRow = exactRow - m.chunkRow * 256;
      const fracCol = exactCol - m.chunkCol * 256;
      const r0 = Math.floor(fracRow);
      const c0 = Math.floor(fracCol);
      const fy = fracRow - r0;
      const fx = fracCol - c0;

      const v00 = pixel(chunk, r0, c0);
      const v10 = pixel(chunk, r0 + 1, c0);
      const v01 = pixel(chunk, r0, c0 + 1);
      const v11 = pixel(chunk, r0 + 1, c0 + 1);

      const hasNodata = v00 === null || v10 === null || v01 === null || v11 === null;
      const elevation = hasNodata
        ? pixel(chunk, m.localRow, m.localCol)
        : Math.round(
            v00! * (1 - fx) * (1 - fy) +
            v01! * fx * (1 - fy) +
            v10! * (1 - fx) * fy +
            v11! * fx * fy,
          );

      results.push({ id: p.id, lat: p.lat, lon: p.lon, elevation });
    }

    // ── Phase 3: Copernicus fallback for non-SRTM points ──
    // Best-effort: ocean/out-of-coverage points. Limited to 50 to avoid timeout.
    const fallbackSlice = copernicusIndices.slice(0, 50);
    await Promise.allSettled(
      fallbackSlice.map(async (idx) => {
        try {
          const p = points[idx];
          const r = await getCopernicusElevation(p.lat, p.lon);
          // Only overwrite if Copernicus has actual data (not ocean nodata)
          if (r.elevation !== null && r.elevation >= -9000) {
            results[idx] = { id: p.id, lat: p.lat, lon: p.lon, elevation: Math.round(r.elevation) };
          }
        } catch {
          // Keep null placeholder
        }
      }),
    );

    return NextResponse.json({ results }, {
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
