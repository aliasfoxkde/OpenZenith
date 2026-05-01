/**
 * Batch elevation endpoint.
 *
 * Accepts multiple lat/lon points and returns elevations in a single request.
 * Uses getTileData() at zoom 12 (~1.7km tiles) for reliable SRTM coverage.
 * Falls back to AWS Terrain Tiles if HuggingFace assembly fails.
 *
 * For single-point precision, use /api/elevation instead.
 *
 * POST /api/elevation/batch
 * Body: { points: [{lat, lon, id?}, ...] }
 * Response: { results: [{lat, lon, elevation, id?}, ...] }
 */

import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { latLonToTile } from "@/lib/srtm/zoom-math";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

export async function OPTIONS() {
  return corsPreflightResponse();
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

function sampleElevation(
  tileData: { data: Int16Array; width: number; height: number },
  lat: number,
  lon: number,
  zoom: number,
): number | null {
  const { x, y } = latLonToTile(lat, lon, zoom);
  const n = 2 ** zoom;
  const xFrac = ((lon + 180) / 360) * n - x;
  const latRad = (lat * Math.PI) / 180;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - y;

  const w = tileData.width;
  const h = tileData.height;
  const px = xFrac * (w - 1);
  const py = yFrac * (h - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = px - x0;
  const fy = py - y0;

  const h00 = tileData.data[y0 * w + x0];
  const h10 = tileData.data[y0 * w + x1];
  const h01 = tileData.data[y1 * w + x0];
  const h11 = tileData.data[y1 * w + x1];

  // Skip if all neighbors are nodata
  if (h00 === -32768 && h10 === -32768 && h01 === -32768 && h11 === -32768) {
    return null;
  }

  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
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
    // Use zoom 12 for reliable SRTM coverage (~300m resolution)
    // Zoom 8 was unreliable due to too many chunks per tile
    const zoom = 12;
    const results: BatchResult[] = new Array(points.length);
    const tileCache = new Map<string, { data: Int16Array; width: number; height: number } | null>();

    // Group points by tile
    const tileGroups = new Map<string, number[]>();
    for (let i = 0; i < points.length; i++) {
      const { x, y } = latLonToTile(points[i].lat, points[i].lon, zoom);
      const key = `${x}/${y}`;
      if (!tileGroups.has(key)) tileGroups.set(key, []);
      tileGroups.get(key)!.push(i);
    }

    // Fetch and process each unique tile
    for (const [tileKey, indices] of tileGroups) {
      if (!tileCache.has(tileKey)) {
        try {
          const [x, y] = tileKey.split("/").map(Number);
          const tileData = await getTileData(zoom, x, y, HF_BACKEND);
          tileCache.set(tileKey, tileData);
        } catch {
          tileCache.set(tileKey, null);
        }
      }

      const tileData = tileCache.get(tileKey);
      for (const idx of indices) {
        const p = points[idx];
        const elevation = tileData ? sampleElevation(tileData, p.lat, p.lon, zoom) : null;
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
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
