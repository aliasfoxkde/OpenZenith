/**
 * Downstream trace API — follow flow path from a point to the ocean.
 *
 * POST /api/trace
 * Body: { lat, lon, zoom, max_steps }
 *
 * Returns GeoJSON LineString of the trace path.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPointElevation } from "@/lib/point-elevation";
import { HuggingFaceChunkBackend, OZT2HuggingFaceBackend } from "@/lib/storage/backend";
import { errorResponse } from "@/lib/api-response";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import {
  ELEVATION_NODATA,
  fetchTileWindow,
  haversineMeters,
  makeBilinearSampler,
  tileWindowBounds,
} from "@/lib/terrain-sampler";

export const runtime = "edge";

// OZT2 backend (primary) — z10 tiles from HuggingFace, falls back to merged chunks
const OZT2_BACKEND = new OZT2HuggingFaceBackend({
  repoId: "aliasfox/srtm30m-ozt2-v2",
  fallbackRepoId: "aliasfox/srtm30m-merged",
  zoom: 10,
});

// Merged chunk backend (fallback / direct SRTM chunk access)
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);
const NODATA = ELEVATION_NODATA;

const D8_DR = [0, 1, 1, 1, 0, -1, -1, -1];
const D8_DC = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

// Preflight has nothing to await — stay promise-returning because callers await handlers.
export function OPTIONS() {
  return Promise.resolve(corsPreflightResponse());
}

/** Client request body. Required fields are validated explicitly after parsing. */
interface TraceRequestBody {
  lat?: number;
  lon?: number;
  zoom?: number;
  max_steps?: number;
}

export async function POST(request: NextRequest) {
  let body: TraceRequestBody;
  try {
    body = (await request.json()) as TraceRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const { lat, lon, zoom = 10, max_steps = 1000 } = body;

  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400, headers: CORS_HEADERS });
  }
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400, headers: CORS_HEADERS });
  }

  const z = Math.min(14, Math.max(5, zoom));
  const maxSteps = Math.min(10000, Math.max(1, max_steps));

  // Validate starting point elevation via OZT2 (primary) then merged chunks (fallback)
  try {
    let startElevVal: number | null = null;
    try {
      startElevVal = await OZT2_BACKEND.getElevation(lat, lon);
    } catch {
      // Fall through to merged chunks
    }
    if (startElevVal === null) {
      try {
        const fallback = await getPointElevation(lat, lon, HF_BACKEND);
        if (fallback) startElevVal = fallback.elevation;
      } catch {
        // Fall through
      }
    }
    if (startElevVal === null || startElevVal <= NODATA) {
      return NextResponse.json(
        { error: "No elevation data at starting point" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
  } catch {
    // Proceed — tile loading will catch missing data
  }

  try {
    const cellSizeDeg = 180 / (2 ** z * 256);
    const _cellSizeM = cellSizeDeg * 111320;

    // Load initial grid centered on starting point
    const radius = 50;
    const { tileXMin, tileXMax, tileYMin, tileYMax } = tileWindowBounds(z, lat, lon, radius);

    // Shared kernels (cycle V C1 / cycle VI D1): window bounds + window fetch
    // + bilinear sample — verbatim arithmetic from the closure this replaces
    // (route fixtures pin outputs).
    const tileDataMap = await fetchTileWindow(z, tileXMin, tileXMax, tileYMin, tileYMax, HF_BACKEND);
    const sampleElevation = makeBilinearSampler(z, tileDataMap);

    function d8FromPoint(latPt: number, lonPt: number): { dir: number; elev: number; lat: number; lon: number } | null {
      const n2 = 2 ** z;
      const tileX = Math.floor(((lonPt + 180) / 360) * n2);
      const latRad2 = (latPt * Math.PI) / 180;
      const tileY = Math.floor(((1 - Math.log(Math.tan(latRad2) + 1 / Math.cos(latRad2)) / Math.PI) / 2) * n2);
      const key = `${tileX}/${tileY}`;
      const tile = tileDataMap.get(key);
      if (!tile) return null;

      const px = ((lonPt + 180) / 360) * n2 * 256 - tileX * 256;
      const py = ((1 - Math.log(Math.tan(latRad2) + 1 / Math.cos(latRad2)) / Math.PI) / 2) * n2 * 256 - tileY * 256;
      const x0 = Math.max(0, Math.min(255, Math.floor(px)));
      const y0 = Math.max(0, Math.min(255, Math.floor(py)));
      const x1 = Math.min(255, x0 + 1);
      const y1 = Math.min(255, y0 + 1);
      const fx = px - x0,
        fy = py - y0;

      // bounds: x0/x1 and y0/y1 clamped to [0,255]; tile is a 256x256 (65536) grid
      const h00 = tile[y0 * 256 + x0]!;
      const h10 = tile[y0 * 256 + x1]!;
      const h01 = tile[y1 * 256 + x0]!;
      const h11 = tile[y1 * 256 + x1]!;

      if (h00 === NODATA && h10 === NODATA && h01 === NODATA && h11 === NODATA) return null;
      const centerElev = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;

      let bestDir = -1,
        bestDrop = 0;
      // bounds: d < 8 and D8_DR/D8_DC are 8-entry literals
      for (let d = 0; d < 8; d++) {
        const stepLat = cellSizeDeg * D8_DR[d]!;
        const stepLon = (cellSizeDeg * D8_DC[d]!) / Math.cos((latPt * Math.PI) / 180);
        const neighborLat = latPt + stepLat;
        const neighborLon = lonPt + stepLon;

        const nKey = `${Math.floor(((neighborLon + 180) / 360) * n2)}/${Math.floor(((1 - Math.log(Math.tan((neighborLat * Math.PI) / 180) + 1 / Math.cos((neighborLat * Math.PI) / 180)) / Math.PI) / 2) * n2)}`;
        const nTile = tileDataMap.get(nKey);
        if (!nTile) continue;

        // bounds: nKey is "<int>/<int>" so split always yields both parts
        const npx = ((neighborLon + 180) / 360) * n2 * 256 - parseInt(nKey.split("/")[0]!) * 256;
        const npy =
          ((1 -
            Math.log(Math.tan((neighborLat * Math.PI) / 180) + 1 / Math.cos((neighborLat * Math.PI) / 180)) / Math.PI) /
            2) *
            n2 *
            256 -
          parseInt(nKey.split("/")[1]!) * 256;
        const nx0 = Math.max(0, Math.min(255, Math.floor(npx)));
        const ny0 = Math.max(0, Math.min(255, Math.floor(npy)));
        const nx1 = Math.min(255, nx0 + 1),
          ny1 = Math.min(255, ny0 + 1);
        const nfx = npx - nx0,
          nfy = npy - ny0;
        // bounds: nx0/nx1 and ny0/ny1 clamped to [0,255]; nTile is a 256x256 (65536) grid
        const nh00 = nTile[ny0 * 256 + nx0]!,
          nh10 = nTile[ny0 * 256 + nx1]!;
        const nh01 = nTile[ny1 * 256 + nx0]!,
          nh11 = nTile[ny1 * 256 + nx1]!;
        if (nh00 === NODATA && nh10 === NODATA && nh01 === NODATA && nh11 === NODATA) continue;
        const nElev = nh00 * (1 - nfx) * (1 - nfy) + nh10 * nfx * (1 - nfy) + nh01 * (1 - nfx) * nfy + nh11 * nfx * nfy;
        const drop = centerElev - nElev;
        if (drop > bestDrop) {
          bestDrop = drop;
          bestDir = d;
        }
      }
      if (bestDir === -1) return null;
      return { dir: bestDir, elev: centerElev, lat: latPt, lon: lonPt };
    }

    const startElev = sampleElevation(lat, lon);
    if (startElev <= NODATA) {
      return NextResponse.json(
        { error: "No elevation data at starting point" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const path: [number, number][] = [[Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6]];
    const elevations: number[] = [Math.round(startElev * 10) / 10];
    const distances: number[] = [0];

    let currentLat = lat;
    let currentLon = lon;
    let totalDist = 0;

    for (let step = 0; step < maxSteps; step++) {
      const result = d8FromPoint(currentLat, currentLon);
      if (!result || result.dir === -1) break;

      // bounds: result.dir is 0..7 (d8 bestDir; -1 excluded above) and the D8_* tables are 8-entry literals
      const stepDeg = cellSizeDeg * D8_DIST[result.dir]!;
      const stepLat = stepDeg * D8_DR[result.dir]!;
      const stepLon = (stepDeg * D8_DC[result.dir]!) / Math.cos((currentLat * Math.PI) / 180);

      currentLat += stepLat;
      currentLon += stepLon;

      const newElev = sampleElevation(currentLat, currentLon);
      if (newElev <= NODATA) break;

      const last = path[path.length - 1]!; // bounds: path always holds the seed point
      totalDist += haversineMeters(last[0], last[1], currentLat, currentLon);
      path.push([Math.round(currentLat * 1e6) / 1e6, Math.round(currentLon * 1e6) / 1e6]);
      elevations.push(Math.round(newElev * 10) / 10);
      distances.push(Math.round(totalDist * 10) / 10);

      if (newElev <= 0) break; // reached ocean
    }

    return NextResponse.json(
      {
        start: [lat, lon],
        end: [currentLat, currentLon],
        start_elev: elevations[0],
        end_elev: elevations[elevations.length - 1],
        total_distance: Math.round(totalDist),
        steps: path.length - 1,
        path,
        elevations,
        distances,
        geojson: {
          type: "Feature",
          geometry: { type: "LineString", coordinates: path },
          properties: {
            start: [lat, lon],
            end: [currentLat, currentLon],
            start_elev: elevations[0],
            end_elev: elevations[elevations.length - 1],
            total_distance: Math.round(totalDist),
            steps: path.length - 1,
          },
        },
      },
      {
        headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" },
      },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
