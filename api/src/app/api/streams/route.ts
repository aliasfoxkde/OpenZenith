/**
 * Stream network extraction API — extract streams from flow accumulation.
 *
 * POST /api/streams
 * Body: { lat, lon, zoom, radius_cells, threshold }
 *
 * Returns GeoJSON LineString features representing the stream network.
 */

import { NextRequest, NextResponse } from "next/server";
import { D8_DC, D8_DR, TERRAIN_NODATA, d8FlowDirection, flowAccumulation } from "@/lib/terrain-grid";
import { openHydroGrid } from "@/lib/hydro-params";
import { pixelToLatLon } from "@/lib/srtm/zoom-math";
import { errorResponse } from "@/lib/api-response";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

/** Client request body. Required fields are validated explicitly after parsing. */
interface StreamsRequestBody {
  lat?: number;
  lon?: number;
  zoom?: number;
  radius_cells?: number;
  threshold?: number;
}

export async function POST(request: NextRequest) {
  let body: StreamsRequestBody;
  try {
    body = (await request.json()) as StreamsRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    // Shared hydrology opener (cycle V C3 / cycle VI D2): parse/validate +
    // start-elevation gate + assembled grid; !ok becomes the 400 body, a
    // throw from the assembly falls through to the 502 catch below.
    const opened = await openHydroGrid(body);
    if (!opened.ok) {
      return NextResponse.json({ error: opened.message }, { status: 400, headers: CORS_HEADERS });
    }
    const { zoom, threshold } = opened;
    // destructure-default parity: only `undefined` takes the 100 (explicit null clamps to 1, as before)
    const thresh = Math.max(1, Math.min(10000, threshold === undefined ? 100 : threshold));
    const {
      dem,
      rows: gridRows,
      cols: gridCols,
      minPixelX,
      minPixelY,
    } = opened.grid;

    const flowDir = d8FlowDirection(dem, gridRows, gridCols, TERRAIN_NODATA);
    const accum = flowAccumulation(flowDir, gridRows, gridCols);

    // Extract streams as GeoJSON
    const features: GeoJSON.Feature[] = [];
    const visited = new Uint8Array(gridRows * gridCols);

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const idx = r * gridCols + c;
        // bounds: idx is a row-major cell of the gridRows*gridCols accum grid
        if (accum[idx]! < thresh) continue;

        // Start of a stream segment — trace downhill
        const coords: [number, number][] = [];
        let cr = r,
          cc = c;

        while (cr >= 0 && cr < gridRows && cc >= 0 && cc < gridCols) {
          const cidx = cr * gridCols + cc;
          if (accum[cidx]! < thresh || visited[cidx]) break; // bounds: cidx in range, as above
          visited[cidx] = 1;

          // Convert grid position to lat/lon via global pixel space —
          // tile-index math here would mis-scale the pixel span by 256x.
          const { lat: cellLat, lon: cellLon } = pixelToLatLon(zoom, minPixelX + cc + 0.5, minPixelY + cr + 0.5);
          coords.push([Math.round(cellLon * 1e6) / 1e6, Math.round(cellLat * 1e6) / 1e6]);

          const d = flowDir[cidx]!; // bounds: cidx in range, as above
          if (d === -1) break;
          // bounds: flowDir holds 0..7 (-1 excluded above); D8_* are 8-entry tables
          cr += D8_DR[d]!;
          cc += D8_DC[d]!;
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
    return errorResponse(err);
  }
}
