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
import {
  TERRAIN_NODATA,
  assembleTerrainGrid,
  computeSlope,
  d8FlowDirection,
  decimateGrid,
  flowAccumulation,
} from "@/lib/terrain-grid";
import { gateStartElevation, parseHydroPrologue } from "@/lib/hydro-params";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

/** Client request body. Required fields are validated explicitly after parsing. */
interface TwiRequestBody {
  lat?: number;
  lon?: number;
  zoom?: number;
  radius_cells?: number;
}

export async function POST(request: NextRequest) {
  let body: TwiRequestBody;
  try {
    body = (await request.json()) as TwiRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  // Shared hydrology prologue (cycle V, C3): parse/validate + start-elevation gate.
  const prologue = parseHydroPrologue(body);
  if (!prologue.ok) {
    return NextResponse.json({ error: prologue.message }, { status: 400, headers: CORS_HEADERS });
  }
  const { lat, lon, zoom, radius } = prologue;

  const gate = await gateStartElevation(lat, lon);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const {
      dem,
      rows: gridRows,
      cols: gridCols,
      cellSizeDeg,
      cellSizeM,
    } = await assembleTerrainGrid({
      lat,
      lon,
      radius,
      zoom,
    });

    const flowDir = d8FlowDirection(dem, gridRows, gridCols, TERRAIN_NODATA);
    const accum = flowAccumulation(flowDir, gridRows, gridCols);
    const slope = computeSlope(dem, gridRows, gridCols, cellSizeM, TERRAIN_NODATA);

    const cellArea = cellSizeM * cellSizeM;
    const twiGrid = new Float32Array(gridRows * gridCols);

    // bounds: i < twiGrid.length = gridRows*gridCols, and dem/slope/accum are all
    // gridRows*gridCols arrays returned by the assemble/compute calls above
    for (let i = 0; i < twiGrid.length; i++) {
      if (dem[i]! <= TERRAIN_NODATA || isNaN(slope[i]!) || slope[i]! < 0.1) {
        twiGrid[i] = NaN;
        continue;
      }
      const sca = accum[i]! * cellArea;
      const slopeRad = (slope[i]! * Math.PI) / 180;
      twiGrid[i] = Math.log(sca / Math.tan(slopeRad));
    }

    let sum = 0,
      count = 0,
      min = Infinity,
      max = -Infinity;
    const vals: number[] = [];
    for (let i = 0; i < twiGrid.length; i++) {
      const v = twiGrid[i]!; // bounds: i < twiGrid.length
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
    // bounds: count is even and > 0 here, so count/2-1 >= 0 and count/2 < count = sorted.length
    const median =
      count > 0 ? (count % 2 ? sorted[Math.floor(count / 2)]! : (sorted[count / 2 - 1]! + sorted[count / 2]!) / 2) : 0;

    const ds = radius > 100 ? 4 : radius > 50 ? 2 : 1;
    const sampledGrid = decimateGrid(
      twiGrid,
      gridRows,
      gridCols,
      ds,
      (v) => !isNaN(v) && isFinite(v),
      (v) => Math.round(v * 100) / 100,
    );

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
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
