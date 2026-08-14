/**
 * Topographic Wetness Index (TWI) API.
 *
 * POST /api/twi
 * Body: { lat, lon, zoom, radius_cells }
 *
 * TWI = ln(a / tan(β)) where a = specific catchment area, β = slope in radians.
 * High TWI = wet / water-accumulating areas. Low TWI = ridges / well-drained.
 *
 * Returns JSON grid with TWI values.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { latLonToTile, tileToLatLon } from "@/lib/srtm/zoom-math";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

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
      let maxSlope = 0,
        bestDir = -1;
      for (let d = 0; d < 8; d++) {
        const nr = r + D8_DR[d],
          nc = c + D8_DC[d];
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
  let changed = true,
    iter = 0;
  while (changed && iter++ < rows * cols) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const d = flowDir[idx];
        if (d === -1) continue;
        const nr = r + D8_DR[d],
          nc = c + D8_DC[d];
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

function computeSlope(dem: Float32Array, rows: number, cols: number, cellSizeM: number, nodata: number): Float32Array {
  const result = new Float32Array(rows * cols);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx = r * cols + c;
      if (dem[idx] <= nodata) {
        result[idx] = NaN;
        continue;
      }
      const a = dem[(r - 1) * cols + (c - 1)],
        b = dem[(r - 1) * cols + c],
        c_ = dem[(r - 1) * cols + (c + 1)];
      const d = dem[r * cols + (c - 1)],
        f = dem[r * cols + (c + 1)];
      const g = dem[(r + 1) * cols + (c - 1)],
        h = dem[(r + 1) * cols + c],
        i = dem[(r + 1) * cols + (c + 1)];
      if (
        a <= nodata ||
        b <= nodata ||
        c_ <= nodata ||
        d <= nodata ||
        f <= nodata ||
        g <= nodata ||
        h <= nodata ||
        i <= nodata
      ) {
        result[idx] = NaN;
        continue;
      }
      const dzDx = (c_ + 2 * f + i - (a + 2 * d + g)) / (8 * cellSizeM);
      const dzDy = (a + 2 * b + c_ - (g + 2 * h + i)) / (8 * cellSizeM);
      result[idx] = (Math.atan(Math.sqrt(dzDx * dzDx + dzDy * dzDy)) * 180) / Math.PI;
    }
  }
  return result;
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(request: NextRequest) {
  let body: { lat?: number; lon?: number; zoom?: number; radius_cells?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const { lat, lon, zoom = 10, radius_cells = 100 } = body;

  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400, headers: CORS_HEADERS });
  }
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400, headers: CORS_HEADERS });
  }

  const radius = Math.min(200, Math.max(10, radius_cells));

  try {
    const gridRows = 2 * radius + 1;
    const gridCols = 2 * radius + 1;
    const n = 2 ** zoom;
    const cellSizeDeg = 180 / (n * 256);
    const cellSizeM = cellSizeDeg * 111320;

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
          /* unavailable */
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
        const fx = px - x0,
          fy = py - y0;
        const w = 256;
        const h00 = tile[y0 * w + x0],
          h10 = tile[y0 * w + x1],
          h01 = tile[y1 * w + x0],
          h11 = tile[y1 * w + x1];
        if (h00 === NODATA && h10 === NODATA && h01 === NODATA && h11 === NODATA) {
          dem[r * gridCols + c] = NODATA;
          continue;
        }
        dem[r * gridCols + c] = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      }
    }

    const flowDir = d8FlowDirection(dem, gridRows, gridCols, NODATA);
    const accum = flowAccumulation(flowDir, gridRows, gridCols);
    const slope = computeSlope(dem, gridRows, gridCols, cellSizeM, NODATA);

    const cellArea = cellSizeM * cellSizeM;
    const twiGrid = new Float32Array(gridRows * gridCols);

    for (let i = 0; i < twiGrid.length; i++) {
      if (dem[i] <= NODATA || isNaN(slope[i]) || slope[i] < 0.1) {
        twiGrid[i] = NaN;
        continue;
      }
      const sca = accum[i] * cellArea;
      const slopeRad = (slope[i] * Math.PI) / 180;
      twiGrid[i] = Math.log(sca / Math.tan(slopeRad));
    }

    let sum = 0,
      count = 0,
      min = Infinity,
      max = -Infinity;
    const vals: number[] = [];
    for (let i = 0; i < twiGrid.length; i++) {
      const v = twiGrid[i];
      if (!isNaN(v) && isFinite(v)) {
        sum += v;
        count++;
        if (v < min) min = v;
        if (v > max) max = v;
        vals.push(v);
      }
    }
    const mean = count > 0 ? sum / count : 0;
    const sorted = vals.sort((a, b) => a - b);
    const median =
      count > 0 ? (count % 2 ? sorted[Math.floor(count / 2)] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2) : 0;

    const ds = radius > 100 ? 4 : radius > 50 ? 2 : 1;
    const sampledGrid: (number | null)[][] = [];
    for (let r = 0; r < gridRows; r += ds) {
      const row: (number | null)[] = [];
      for (let c = 0; c < gridCols; c += ds) {
        const v = twiGrid[r * gridCols + c];
        row.push(!isNaN(v) && isFinite(v) ? Math.round(v * 100) / 100 : null);
      }
      sampledGrid.push(row);
    }

    return NextResponse.json(
      {
        center: { lat, lon },
        radius_cells: radius,
        zoom,
        cell_size_deg: Math.round(cellSizeDeg * 1e6) / 1e6,
        stats:
          count > 0
            ? {
                mean: Math.round(mean * 100) / 100,
                median: Math.round(median * 100) / 100,
                min: Math.round(min * 100) / 100,
                max: Math.round(max * 100) / 100,
                count,
              }
            : null,
        grid: sampledGrid,
        units: "ln(m)",
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
