/**
 * Watershed delineation API — trace upstream area from a pour point.
 *
 * POST /api/watershed
 * Body: { lat, lon, zoom, radius_cells }
 *
 * Returns GeoJSON boundary + area stats.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  D8_DC,
  D8_DR,
  TERRAIN_NODATA,
  assembleTerrainGrid,
  d8FlowDirection,
  resolveStartElevation,
} from "@/lib/terrain-grid";
import { pixelToLatLon } from "@/lib/srtm/zoom-math";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

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
    const next = queue.shift();
    if (!next) break;
    const [r, c] = next;
    // bounds: d < 8 === D8_DR/D8_DC length
    for (let d = 0; d < 8; d++) {
      const nr = r + D8_DR[d]!;
      const nc = c + D8_DC[d]!;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = nr * cols + nc;
      if (visited.has(nIdx)) continue;
      if (dem[nIdx]! <= TERRAIN_NODATA) continue;
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

export function OPTIONS() {
  return corsPreflightResponse();
}

/** Client request body. Required fields are validated explicitly after parsing. */
interface WatershedRequestBody {
  lat?: number;
  lon?: number;
  zoom?: number;
  radius_cells?: number;
}

export async function POST(request: NextRequest) {
  let body: WatershedRequestBody;
  try {
    body = (await request.json()) as WatershedRequestBody;
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

  // Validate starting point elevation via OZT2 (primary) then merged chunks (fallback)
  try {
    const startElevVal = await resolveStartElevation(lat, lon);
    if (startElevVal === null || startElevVal <= TERRAIN_NODATA) {
      return NextResponse.json(
        { error: "No elevation data at starting point" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
  } catch {
    // Proceed — tile loading will catch missing data
  }

  try {
    const {
      dem,
      rows: gridRows,
      cols: gridCols,
      cellSizeDeg,
      cellSizeM,
      minPixelX,
      minPixelY,
    } = await assembleTerrainGrid({ lat, lon, radius, zoom });

    // Center row/col in grid
    const centerRow = radius;
    const centerCol = radius;

    // If center is nodata, find nearest valid cell
    let cr = centerRow,
      cc = centerCol;
    // bounds: cr/cc <= radius and the grid is (2*radius+1)^2 row-major cells
    if (dem[cr * gridCols + cc]! <= TERRAIN_NODATA) {
      let bestDist = Infinity;
      for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
          if (dem[r * gridCols + c]! > TERRAIN_NODATA) {
            const d = Math.abs(r - centerRow) + Math.abs(c - centerCol);
            if (d < bestDist) {
              bestDist = d;
              cr = r;
              cc = c;
            }
          }
        }
      }
    }

    const flowDir = d8FlowDirection(dem, gridRows, gridCols, TERRAIN_NODATA);
    const watershed = delineateWatershed(dem, flowDir, cr, cc, gridRows, gridCols);

    // Compute stats
    const wsPixels = watershed.filter((v) => v === 1).length;
    const areaKm2 = (wsPixels * cellSizeM ** 2) / 1e6;

    const elevations: number[] = [];
    for (let i = 0; i < watershed.length; i++) {
      // bounds: i < watershed.length = gridRows*gridCols = dem.length
      if (watershed[i]! === 1 && dem[i]! > TERRAIN_NODATA) elevations.push(dem[i]!);
    }

    const validElevs = elevations.filter((e) => e > TERRAIN_NODATA);
    const minElev = validElevs.length > 0 ? Math.min(...validElevs) : null;
    const maxElev = validElevs.length > 0 ? Math.max(...validElevs) : null;
    const meanElev = validElevs.length > 0 ? validElevs.reduce((a, b) => a + b, 0) / validElevs.length : null;

    // Build boundary GeoJSON — cell centers mapped from global pixel space.
    // Tile-index math here would mis-scale the grid's pixel span by 256x.
    const boundaryCoords: [number, number][] = [];
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        if (watershed[r * gridCols + c] !== 1) continue;
        const isEdge = [0, 1, 2, 3, 4, 5, 6, 7].some((d) => {
          const nr = r + D8_DR[d]!; // bounds: d < 8 === D8_DR/D8_DC length
          const nc = c + D8_DC[d]!;
          return nr < 0 || nr >= gridRows || nc < 0 || nc >= gridCols || watershed[nr * gridCols + nc] !== 1;
        });
        if (isEdge) {
          const { lat: latVal, lon: lonVal } = pixelToLatLon(zoom, minPixelX + c + 0.5, minPixelY + r + 0.5);
          boundaryCoords.push([lonVal, latVal]);
        }
      }
    }

    return NextResponse.json(
      {
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
          features: [
            {
              type: "Feature",
              properties: {
                area_km2: Math.round(areaKm2 * 100) / 100,
                pixels: wsPixels,
                min_elev: minElev !== null ? Math.round(minElev) : null,
                max_elev: maxElev !== null ? Math.round(maxElev) : null,
              },
              geometry: {
                type: boundaryCoords.length > 2 ? "Polygon" : "Point",
                coordinates:
                  boundaryCoords.length > 2
                    ? [[...boundaryCoords, boundaryCoords[0]]]
                    : (boundaryCoords[0] ?? [lon, lat]),
              },
            },
          ],
        },
      },
      {
        headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
