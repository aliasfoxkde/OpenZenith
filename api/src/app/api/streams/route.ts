/**
 * Stream network extraction API — extract streams from flow accumulation.
 *
 * POST /api/streams
 * Body: { lat, lon, zoom, radius_cells, threshold }
 *
 * Returns GeoJSON LineString features representing the stream network.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { getPointElevation } from "@/lib/point-elevation";
import { HuggingFaceChunkBackend, OZT2HuggingFaceBackend } from "@/lib/storage/backend";
import { latLonToTile, tileToLatLon } from "@/lib/srtm/zoom-math";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

// OZT2 backend (primary) — z10 tiles from HuggingFace, falls back to merged chunks
const OZT2_BACKEND = new OZT2HuggingFaceBackend({
  repoId: "aliasfox/srtm30m-ozt2-v2",
  fallbackRepoId: "aliasfox/srtm30m-merged",
  zoom: 10,
});

// Merged chunk backend (fallback / direct SRTM chunk access)
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);
const NODATA = -32768;

const D8_DR = [0, 1, 1, 1, 0, -1, -1, -1];
const D8_DC = [1, 1, 0, -1, -1, -1, 0, 1];

function d8FlowDirection(dem: Float32Array, rows: number, cols: number, nodata: number): Int8Array {
  const flowDir = new Int8Array(rows * cols).fill(-1);
  const DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (dem[idx] <= nodata) continue;
      let maxSlope = 0;
      let bestDir = -1;
      for (let d = 0; d < 8; d++) {
        const nr = r + D8_DR[d];
        const nc = c + D8_DC[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nIdx = nr * cols + nc;
        if (dem[nIdx] <= nodata) continue;
        const slope = (dem[idx] - dem[nIdx]) / DIST[d];
        if (slope > maxSlope) {
          maxSlope = slope;
          bestDir = d;
        }
      }
      flowDir[idx] = bestDir;
    }
  }
  return flowDir;
}

function flowAccumulation(flowDir: Int8Array, rows: number, cols: number): Uint32Array {
  const accum = new Uint32Array(rows * cols).fill(1);
  // Track changes and iterate to convergence
  let changed = true;
  let iterations = 0;
  const maxIter = rows * cols;

  while (changed && iterations < maxIter) {
    changed = false;
    iterations++;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const d = flowDir[idx];
        if (d === -1) continue;
        const nr = r + D8_DR[d];
        const nc = c + D8_DC[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nIdx = nr * cols + nc;
        const newVal = accum[idx] + (accum[nIdx] > 0 ? 1 : 0);
        if (newVal > accum[nIdx]) {
          accum[nIdx] = newVal;
          changed = true;
        }
      }
    }
  }
  return accum;
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(request: NextRequest) {
  let body: { lat?: number; lon?: number; zoom?: number; radius_cells?: number; threshold?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const { lat, lon, zoom = 10, radius_cells = 100, threshold = 100 } = body;

  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400, headers: CORS_HEADERS });
  }

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400, headers: CORS_HEADERS });
  }

  const radius = Math.min(200, Math.max(10, radius_cells));
  const thresh = Math.max(1, Math.min(10000, threshold));

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
    const gridRows = 2 * radius + 1;
    const gridCols = 2 * radius + 1;

    const n = 2 ** zoom;
    const cellSizeDeg = 180 / (n * 256);

    const { x: cx, y: cy } = latLonToTile(lat, lon, zoom);
    const xFrac = ((lon + 180) / 360) * n - cx;
    const latRad = (lat * Math.PI) / 180;
    const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - cy;

    const centerPixelX = cx * 256 + xFrac * 256;
    const centerPixelY = cy * 256 + yFrac * 256;

    const minPixelX = Math.floor(centerPixelX - radius);
    const maxPixelX = Math.ceil(centerPixelX + radius);
    const minPixelY = Math.floor(centerPixelY - radius);
    const maxPixelY = Math.ceil(centerPixelY + radius);

    const tileXMin = Math.floor(minPixelX / 256);
    const tileXMax = Math.floor(maxPixelX / 256);
    const tileYMin = Math.floor(minPixelY / 256);
    const tileYMax = Math.floor(maxPixelY / 256);

    const tileDataMap = new Map<string, Int16Array>();
    for (let ty = tileYMin; ty <= tileYMax; ty++) {
      for (let tx = tileXMin; tx <= tileXMax; tx++) {
        const key = `${tx}/${ty}`;
        try {
          const tile = await getTileData(zoom, tx, ty, HF_BACKEND);
          tileDataMap.set(key, tile.data);
        } catch {
          // unavailable
        }
      }
    }

    const dem = new Float32Array(gridRows * gridCols);
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const globalX = minPixelX + c;
        const globalY = minPixelY + r;
        const tileX = Math.floor(globalX / 256);
        const tileY = Math.floor(globalY / 256);
        const key = `${tileX}/${tileY}`;
        const tile = tileDataMap.get(key);

        if (!tile) {
          dem[r * gridCols + c] = NODATA;
          continue;
        }

        const px = globalX - tileX * 256;
        const py = globalY - tileY * 256;
        const x0 = Math.max(0, Math.min(255, px));
        const y0 = Math.max(0, Math.min(255, py));
        const x1 = Math.min(255, x0 + 1);
        const y1 = Math.min(255, y0 + 1);
        const fx = px - x0;
        const fy = py - y0;

        const w = 256;
        const h00 = tile[y0 * w + x0];
        const h10 = tile[y0 * w + x1];
        const h01 = tile[y1 * w + x0];
        const h11 = tile[y1 * w + x1];

        if (h00 === NODATA && h10 === NODATA && h01 === NODATA && h11 === NODATA) {
          dem[r * gridCols + c] = NODATA;
          continue;
        }
        dem[r * gridCols + c] = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      }
    }

    const flowDir = d8FlowDirection(dem, gridRows, gridCols, NODATA);
    const accum = flowAccumulation(flowDir, gridRows, gridCols);

    // Extract streams as GeoJSON
    const features: GeoJSON.Feature[] = [];
    const visited = new Uint8Array(gridRows * gridCols);

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const idx = r * gridCols + c;
        if (accum[idx] < thresh) continue;

        // Start of a stream segment — trace downhill
        const coords: [number, number][] = [];
        let cr = r,
          cc = c;

        while (cr >= 0 && cr < gridRows && cc >= 0 && cc < gridCols) {
          const cidx = cr * gridCols + cc;
          if (accum[cidx] < thresh || visited[cidx]) break;
          visited[cidx] = 1;

          // Convert grid position to lat/lon
          const tileNorth = tileToLatLon(zoom, 0, tileYMin).north;
          const tileSouth = tileToLatLon(zoom, 0, tileYMax + 1).south;
          const tileWest = ((tileXMin * 256) / n) * 360 - 180;
          const tileEast = (((tileXMax + 1) * 256) / n) * 360 - 180;
          const cellLat = tileNorth - (cr / gridRows) * (tileNorth - tileSouth);
          const cellLon = tileWest + (cc / gridCols) * (tileEast - tileWest);
          coords.push([Math.round(cellLon * 1e6) / 1e6, Math.round(cellLat * 1e6) / 1e6]);

          const d = flowDir[cidx];
          if (d === -1) break;
          cr += D8_DR[d];
          cc += D8_DC[d];
        }

        if (coords.length >= 2) {
          features.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
            properties: { stream_order: 1, length_cells: coords.length },
          });
        }
      }
    }

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        stats: {
          stream_count: features.length,
          threshold,
          total_cells: gridRows * gridCols,
        },
      },
      {
        headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
