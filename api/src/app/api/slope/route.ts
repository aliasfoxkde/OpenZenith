/**
 * Terrain slope API — compute slope in degrees for a geographic area.
 *
 * GET /api/slope?lat=40.7&lon=-74.0&radius=50&zoom=10
 *
 * Query params:
 *   lat, lon   — center point (required)
 *   radius     — grid radius in cells (default 50, max 200)
 *   zoom       — tile zoom level (default 10)
 *
 * Returns slope grid as JSON with stats.
 */

import { NextRequest, NextResponse } from "next/server";
import { TERRAIN_NODATA, assembleTerrainGrid, computeSlope, decimateGrid } from "@/lib/terrain-grid";
import { tileToLatLon } from "@/lib/srtm/zoom-math";
import { errorResponse } from "@/lib/api-response";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export function OPTIONS() {
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
    const {
      dem,
      rows: gridRows,
      cols: gridCols,
      cellSizeDeg,
      cellSizeM,
      tileXMin,
      tileXMax,
      tileYMin,
      tileYMax,
    } = await assembleTerrainGrid({ lat, lon, radius, zoom });

    // Compute slope (Horn's method, degrees 0-90)
    const slopeGrid = computeSlope(dem, gridRows, gridCols, cellSizeM, TERRAIN_NODATA);

    // Stats from valid cells
    let sum = 0,
      count = 0,
      min = Infinity,
      max = -Infinity;
    const vals: number[] = [];
    for (let i = 0; i < slopeGrid.length; i++) {
      const v = slopeGrid[i]!; // bounds: i < slopeGrid.length
      if (!isNaN(v)) {
        sum += v;
        count++;
        if (v < min) min = v;
        if (v > max) max = v;
        vals.push(v);
      }
    }

    const mean = count > 0 ? sum / count : 0;
    const sorted = vals.sort((a, b) => a - b);
    // bounds: count is even and > 0 here, so count/2-1 >= 0 and count/2 < count = sorted.length
    const median =
      count > 0 ? (count % 2 ? sorted[Math.floor(count / 2)]! : (sorted[count / 2 - 1]! + sorted[count / 2]!) / 2) : 0;
    const variance = count > 0 ? vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count : 0;
    const std = Math.sqrt(variance);

    const stats =
      count > 0
        ? {
            mean: Math.round(mean * 100) / 100,
            median: Math.round(median * 100) / 100,
            min: Math.round(min * 100) / 100,
            max: Math.round(max * 100) / 100,
            std: Math.round(std * 100) / 100,
            count,
          }
        : null;

    // Geographic bounds of the grid
    const n = 2 ** zoom;
    const { north: latMax } = tileToLatLon(zoom, 0, tileYMin);
    const { south: latMin } = tileToLatLon(zoom, 0, tileYMax + 1);
    const lonMin = ((tileXMin * 256) / n) * 360 - 180;
    const lonMax = (((tileXMax + 1) * 256) / n) * 360 - 180;

    // Downsample for response size
    const ds = radius > 100 ? 4 : radius > 50 ? 2 : 1;
    const sampledGrid = decimateGrid(
      slopeGrid,
      gridRows,
      gridCols,
      ds,
      (v) => !isNaN(v),
      (v) => Math.round(v * 100) / 100,
    );

    return NextResponse.json(
      {
        center: { lat, lon },
        bounds: { latMin, latMax, lonMin, lonMax },
        radius_cells: radius,
        zoom,
        cell_size_deg: Math.round(cellSizeDeg * 1e6) / 1e6,
        stats,
        grid: sampledGrid,
        units: "degrees",
      },
      {
        headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" },
      },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
