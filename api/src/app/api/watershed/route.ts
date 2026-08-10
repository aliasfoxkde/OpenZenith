/**
 * Watershed delineation API — trace upstream area from a pour point.
 *
 * POST /api/watershed
 * Body: { lat, lon, zoom, radius_cells }
 *
 * Returns GeoJSON boundary + area stats.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { latLonToTile, tileToLatLon } from "@/lib/srtm/zoom-math";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);
const NODATA = -32768;

// D8: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE
const D8_DR = [0, 1, 1, 1, 0, -1, -1, -1];
const D8_DC = [1, 1, 0, -1, -1, -1, 0, 1];

function fillDepressions(dem: Float32Array, rows: number, cols: number, nodata: number): Float32Array {
  // Simple flat fill: for now just return dem as-is
  // Full priority-flood would require a heap; keeping it fast for edge
  return dem;
}

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

  // Process in topological order (cells with flow dirs before their targets)
  // Simple iterative pass — converges in a few iterations for most grids
  for (let iter = 0; iter < rows * cols; iter++) {
    let changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const d = flowDir[idx];
        if (d === -1) continue;
        const nr = r + D8_DR[d];
        const nc = c + D8_DC[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nIdx = nr * cols + nc;
        if (accum[nIdx] < accum[idx] + 1) {
          accum[nIdx] = accum[idx] + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return accum;
}

function delineateWatershed(
  dem: Float32Array,
  flowDir: Int8Array,
  centerRow: number,
  centerCol: number,
  rows: number,
  cols: number,
): Uint8Array {
  const watershed = new Uint8Array(rows * cols);
  watershed[centerRow * cols + centerCol] = 1;

  // BFS upstream
  const queue: [number, number][] = [[centerRow, centerCol]];
  const visited = new Set<number>();
  visited.add(centerRow * cols + centerCol);

  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    for (let d = 0; d < 8; d++) {
      const nr = r + D8_DR[d];
      const nc = c + D8_DC[d];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = nr * cols + nc;
      if (visited.has(nIdx)) continue;
      if (dem[nIdx] <= NODATA) continue;
      // Does this neighbor flow into (r,c)?
      const opp = (d + 4) % 8;
      if (flowDir[nIdx] === opp) {
        visited.add(nIdx);
        watershed[nIdx] = 1;
        queue.push([nr, nc]);
      }
    }
  }

  return watershed;
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

        if (!tile) { dem[r * gridCols + c] = NODATA; continue; }

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

    // Center row/col in grid
    const centerRow = radius;
    const centerCol = radius;

    // If center is nodata, find nearest valid cell
    let cr = centerRow, cc = centerCol;
    if (dem[cr * gridCols + cc] <= NODATA) {
      let bestDist = Infinity;
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          if (dem[r * gridCols + c] > NODATA) {
            const d = Math.abs(r - centerRow) + Math.abs(c - centerCol);
            if (d < bestDist) { bestDist = d; cr = r; cc = c; }
          }
        }
      }
    }

    const flowDir = d8FlowDirection(dem, gridRows, gridCols, NODATA);
    const watershed = delineateWatershed(dem, flowDir, cr, cc, gridRows, gridCols);

    // Compute stats
    const wsPixels = watershed.filter(v => v === 1).length;
    const areaKm2 = wsPixels * (cellSizeM ** 2) / 1e6;

    const elevations: number[] = [];
    for (let i = 0; i < watershed.length; i++) {
      if (watershed[i] === 1 && dem[i] > NODATA) elevations.push(dem[i]);
    }

    const validElevs = elevations.filter(e => e > NODATA);
    const minElev = validElevs.length > 0 ? Math.min(...validElevs) : null;
    const maxElev = validElevs.length > 0 ? Math.max(...validElevs) : null;
    const meanElev = validElevs.length > 0 ? validElevs.reduce((a, b) => a + b, 0) / validElevs.length : null;

    const lonMin = (tileXMin * 256) / n * 360 - 180;
    const lonMax = ((tileXMax + 1) * 256) / n * 360 - 180;

    // Build boundary GeoJSON
    const boundaryCoords: [number, number][] = [];
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        if (watershed[r * gridCols + c] !== 1) continue;
        const isEdge = [0, 1, 2, 3, 4, 5, 6, 7].some(d => {
          const nr = r + D8_DR[d];
          const nc = c + D8_DC[d];
          return nr < 0 || nr >= gridRows || nc < 0 || nc >= gridCols || watershed[nr * gridCols + nc] !== 1;
        });
        if (isEdge) {
          const latVal = (tileToLatLon(zoom, 0, tileYMin).north) - (r / gridRows) * (tileToLatLon(zoom, 0, tileYMin).north - tileToLatLon(zoom, 0, tileYMax + 1).south);
          const lonVal = lonMin + (c / gridCols) * (lonMax - lonMin);
          boundaryCoords.push([lonVal, latVal]);
        }
      }
    }

    return NextResponse.json({
      center: [lat, lon],
      area_km2: Math.round(areaKm2 * 100) / 100,
      pixels: wsPixels,
      min_elev: minElev !== null ? Math.round(minElev) : null,
      max_elev: maxElev !== null ? Math.round(maxElev) : null,
      mean_elev: meanElev !== null ? Math.round(meanElev) : null,
      zoom,
      cell_size_deg: Math.round(cellSizeDeg * 1e6) / 1e6,
      boundary: boundaryCoords.slice(0, 2000),
      geojson: {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {
            area_km2: Math.round(areaKm2 * 100) / 100,
            pixels: wsPixels,
            min_elev: minElev !== null ? Math.round(minElev) : null,
            max_elev: maxElev !== null ? Math.round(maxElev) : null,
          },
          geometry: {
            type: boundaryCoords.length > 2 ? "Polygon" : "Point",
            coordinates: boundaryCoords.length > 2
              ? [[...boundaryCoords, boundaryCoords[0]]]
              : boundaryCoords[0] ?? [lon, lat],
          },
        }],
      },
    }, {
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
