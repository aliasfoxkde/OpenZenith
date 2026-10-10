/**
 * Elevation profile API — extract elevation along a transect.
 *
 * POST /api/profile
 * Body: { lat1, lon1, lat2, lon2, num_points, zoom }
 *
 * Returns JSON with distance (m) and elevation (m) arrays along the line.
 */

import { NextRequest, NextResponse } from "next/server";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { errorResponse } from "@/lib/api-response";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import {
  ELEVATION_NODATA,
  fetchTileWindow,
  haversineMeters,
  makeBilinearSampler,
  tileWindowBounds,
} from "@/lib/terrain-sampler";

export const runtime = "edge";

const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);
const NODATA = ELEVATION_NODATA;

export function OPTIONS() {
  return corsPreflightResponse();
}

/** Client request body. Required fields are validated explicitly after parsing. */
interface ProfileRequestBody {
  lat1?: number;
  lon1?: number;
  lat2?: number;
  lon2?: number;
  num_points?: number;
  zoom?: number;
}

export async function POST(request: NextRequest) {
  let body: ProfileRequestBody;
  try {
    body = (await request.json()) as ProfileRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const { lat1, lon1, lat2, lon2, num_points = 100, zoom = 10 } = body;

  if (typeof lat1 !== "number" || typeof lon1 !== "number" || typeof lat2 !== "number" || typeof lon2 !== "number") {
    return NextResponse.json({ error: "lat1, lon1, lat2, lon2 are required" }, { status: 400, headers: CORS_HEADERS });
  }

  const coords = [
    [lat1, lon1],
    [lat2, lon2],
  ] as [number, number][];
  for (const [la, lo] of coords) {
    if (isNaN(la) || isNaN(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400, headers: CORS_HEADERS });
    }
  }

  const n = Math.max(2, Math.min(1000, num_points));
  const z = Math.min(14, Math.max(5, zoom));

  try {
    const cellSizeDeg = 180 / (2 ** z * 256);
    const _cellSizeM = cellSizeDeg * 111320;

    // Midpoint for tile loading
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;

    // Load tiles around the line — estimate coverage from endpoints
    const maxDist = Math.sqrt((lat2 - lat1) ** 2 + (lon2 - lon1) ** 2);
    const radius = Math.max(10, Math.min(200, Math.ceil((maxDist / cellSizeDeg) * 2)));

    // Shared kernels (cycle V C1 / cycle VI D1): window bounds + window fetch
    // + bilinear sample + haversine — verbatim arithmetic from the closures
    // this replaces (route fixtures pin the outputs).
    const { tileXMin, tileXMax, tileYMin, tileYMax } = tileWindowBounds(z, midLat, midLon, radius);
    const sampleElevation = makeBilinearSampler(
      z,
      await fetchTileWindow(z, tileXMin, tileXMax, tileYMin, tileYMax, HF_BACKEND),
    );

    // Generate evenly-spaced profile points
    const profile: { distance_m: number; elevation: number; lat: number; lon: number }[] = [];
    let totalDist = 0;

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const ptLat = lat1 + (lat2 - lat1) * t;
      const ptLon = lon1 + (lon2 - lon1) * t;
      const elev = sampleElevation(ptLat, ptLon);

      if (i > 0) {
        // bounds: i > 0 and profile already holds i entries
        totalDist += haversineMeters(profile[i - 1]!.lat, profile[i - 1]!.lon, ptLat, ptLon);
      }

      profile.push({
        distance_m: Math.round(totalDist * 10) / 10,
        elevation: elev > NODATA ? Math.round(elev * 10) / 10 : elev,
        lat: Math.round(ptLat * 1e6) / 1e6,
        lon: Math.round(ptLon * 1e6) / 1e6,
      });
    }

    const validElevs = profile.filter((p) => p.elevation > NODATA).map((p) => p.elevation);
    const stats =
      validElevs.length > 0
        ? {
            min: Math.round(Math.min(...validElevs)),
            max: Math.round(Math.max(...validElevs)),
            total_gain: Math.round(
              (profile
                .filter(
                  (_, i) =>
                    // bounds: filter runs over the completed profile; i > 0 above
                    i > 0 && profile[i]!.elevation > NODATA && profile[i]!.elevation > profile[i - 1]!.elevation,
                )
                .reduce(
                  // Rise against the previous profile point. The lookup must run
                  // over `profile` — indexing the filtered array aliases the
                  // point itself and nets every gain to zero.
                  (s, p) =>
                    s + (p.elevation - (profile[Math.max(0, profile.indexOf(p) - 1)]?.elevation ?? p.elevation)),
                  0,
                ) *
                10) /
                10,
            ),
            total_dist: Math.round(totalDist),
          }
        : null;

    return NextResponse.json(
      {
        start: { lat: lat1, lon: lon1 },
        end: { lat: lat2, lon: lon2 },
        num_points: n,
        zoom: z,
        stats,
        profile,
      },
      {
        headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" },
      },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
