/**
 * Terrain aspect API — compass direction of steepest descent (0-360 degrees).
 *
 * GET /api/aspect?lat=40.7&lon=-74.0&radius=50&zoom=10
 *
 * Query params:
 *   lat, lon   — center point (required)
 *   radius     — grid radius in cells (default 50, max 200)
 *   zoom       — tile zoom level (default 10)
 *
 * Returns aspect grid as JSON with stats.
 * 0=N, 90=E, 180=S, 270=W. Flat areas = -1.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { latLonToTile, tileToLatLon } from "@/lib/srtm/zoom-math";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);
const NODATA = -32768;

/**
 * Compute aspect — compass direction of steepest descent in degrees.
 * 0=N, 90=E, 180=S, 270=W. Flat areas = -1.
 */
function computeAspect(dem: Float32Array, rows: number, cols: number, cellSizeM: number, nodata: number): Float32Array {
  const result = new Float32Array(rows * cols);

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx = r * cols + c;
      const e = dem[idx];

      if (e <= nodata) {
        result[idx] = NaN;
        continue;
      }

      const a = dem[(r - 1) * cols + (c - 1)];
      const b = dem[(r - 1) * cols + c];
      const c_ = dem[(r - 1) * cols + (c + 1)];
      const d = dem[r * cols + (c - 1)];
      const f = dem[r * cols + (c + 1)];
      const g = dem[(r + 1) * cols + (c - 1)];
      const h = dem[(r + 1) * cols + c];
      const i = dem[(r + 1) * cols + (c + 1)];

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

      // Flat — no descent direction
      if (Math.abs(dzDx) < 1e-10 && Math.abs(dzDy) < 1e-10) {
        result[idx] = -1;
        continue;
      }

      // atan2(-dzDy, dzDx) gives ascent direction in math coords
      // Negate dzDy because grid y-axis is flipped (row 0 = north)
      const aspectRad = Math.atan2(-dzDy, dzDx);
      // Convert to compass: (90 - math_deg + 180) % 360
      const aspectDeg = (90 - aspectRad * (180 / Math.PI) + 180) % 360;
      result[idx] = Math.round(aspectDeg * 10) / 10;
    }
  }

  return result;
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");
  const radiusStr = searchParams.get("radius");
  const zoomStr = searchParams.get("zoom");

  if (!latStr || !lonStr) {
    return NextResponse.json(
      { error: "Missing required parameters: lat, lon" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  const radius = Math.min(200, Math.max(1, parseInt(radiusStr ?? "50", 10)));
  const zoom = Math.min(14, Math.max(5, parseInt(zoomStr ?? "10", 10)));

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400, headers: CORS_HEADERS });
  }

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
          // unavailable tile
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

    const aspectGrid = computeAspect(dem, gridRows, gridCols, cellSizeM, NODATA);

    // Direction bins (N, NE, E, SE, S, SW, W, NW)
    const dirBins = { N: 0, NE: 0, E: 0, SE: 0, S: 0, SW: 0, W: 0, NW: 0, flat: 0 };
    let count = 0;
    for (let i = 0; i < aspectGrid.length; i++) {
      const v = aspectGrid[i];
      if (isNaN(v)) continue;
      count++;
      if (v === -1) {
        dirBins.flat++;
        continue;
      }
      if (v >= 337.5 || v < 22.5) dirBins.N++;
      else if (v >= 22.5 && v < 67.5) dirBins.NE++;
      else if (v >= 67.5 && v < 112.5) dirBins.E++;
      else if (v >= 112.5 && v < 157.5) dirBins.SE++;
      else if (v >= 157.5 && v < 202.5) dirBins.S++;
      else if (v >= 202.5 && v < 247.5) dirBins.SW++;
      else if (v >= 247.5 && v < 292.5) dirBins.W++;
      else dirBins.NW++;
    }

    const ds = radius > 100 ? 4 : radius > 50 ? 2 : 1;
    const sampledGrid: (number | null)[][] = [];
    for (let r = 0; r < gridRows; r += ds) {
      const row: (number | null)[] = [];
      for (let c = 0; c < gridCols; c += ds) {
        const v = aspectGrid[r * gridCols + c];
        row.push(isNaN(v) ? null : v);
      }
      sampledGrid.push(row);
    }

    const { north: latMax } = tileToLatLon(zoom, 0, tileYMin);
    const { south: latMin } = tileToLatLon(zoom, 0, tileYMax + 1);
    const lonMin = ((tileXMin * 256) / n) * 360 - 180;
    const lonMax = (((tileXMax + 1) * 256) / n) * 360 - 180;

    return NextResponse.json(
      {
        center: { lat, lon },
        bounds: { latMin, latMax, lonMin, lonMax },
        radius_cells: radius,
        zoom,
        cell_size_deg: Math.round(cellSizeDeg * 1e6) / 1e6,
        direction_bins:
          count > 0
            ? {
                N: Math.round((dirBins.N / count) * 1000) / 10,
                NE: Math.round((dirBins.NE / count) * 1000) / 10,
                E: Math.round((dirBins.E / count) * 1000) / 10,
                SE: Math.round((dirBins.SE / count) * 1000) / 10,
                S: Math.round((dirBins.S / count) * 1000) / 10,
                SW: Math.round((dirBins.SW / count) * 1000) / 10,
                W: Math.round((dirBins.W / count) * 1000) / 10,
                NW: Math.round((dirBins.NW / count) * 1000) / 10,
                flat: Math.round((dirBins.flat / count) * 1000) / 10,
              }
            : null,
        valid_cells: count,
        grid: sampledGrid,
        units: "degrees compass (0=N, 90=E, 180=S, 270=W)",
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
