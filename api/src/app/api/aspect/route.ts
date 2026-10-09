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
import { TERRAIN_NODATA, assembleTerrainGrid, computeAspect, decimateGrid } from "@/lib/terrain-grid";
import { tileToLatLon } from "@/lib/srtm/zoom-math";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

// Preflight has nothing to await — stays promise-returning because callers await handlers.
export function OPTIONS() {
  return Promise.resolve(corsPreflightResponse());
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

    const aspectGrid = computeAspect(dem, gridRows, gridCols, cellSizeM, TERRAIN_NODATA);

    // Direction bins (N, NE, E, SE, S, SW, W, NW)
    const dirBins = { N: 0, NE: 0, E: 0, SE: 0, S: 0, SW: 0, W: 0, NW: 0, flat: 0 };
    let count = 0;
    for (let i = 0; i < aspectGrid.length; i++) {
      const v = aspectGrid[i]!; // bounds: i < aspectGrid.length
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
    const sampledGrid = decimateGrid(
      aspectGrid,
      gridRows,
      gridCols,
      ds,
      (v) => !isNaN(v),
      (v) => v,
    );

    const n = 2 ** zoom;
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
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
