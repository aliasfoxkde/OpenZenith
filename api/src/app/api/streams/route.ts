/**
 * Stream network extraction API — extract streams from flow accumulation.
 *
 * POST /api/streams
 * Body: { lat, lon, zoom, radius_cells, threshold }
 *
 * Returns GeoJSON LineString features representing the stream network.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  D8_DC,
  D8_DR,
  TERRAIN_NODATA,
  assembleTerrainGrid,
  d8FlowDirection,
  flowAccumulation,
  resolveStartElevation,
} from "@/lib/terrain-grid";
import { pixelToLatLon } from "@/lib/srtm/zoom-math";
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
    const { dem, rows: gridRows, cols: gridCols, minPixelX, minPixelY } = await assembleTerrainGrid({
      lat,
      lon,
      radius,
      zoom,
    });

    const flowDir = d8FlowDirection(dem, gridRows, gridCols, TERRAIN_NODATA);
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

          // Convert grid position to lat/lon via global pixel space —
          // tile-index math here would mis-scale the pixel span by 256x.
          const { lat: cellLat, lon: cellLon } = pixelToLatLon(zoom, minPixelX + cc + 0.5, minPixelY + cr + 0.5);
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
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
