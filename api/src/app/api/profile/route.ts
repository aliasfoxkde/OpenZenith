/**
 * Elevation profile API — extract elevation along a transect.
 *
 * POST /api/profile
 * Body: { lat1, lon1, lat2, lon2, num_points, zoom }
 *
 * Returns JSON with distance (m) and elevation (m) arrays along the line.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { latLonToTile } from "@/lib/srtm/zoom-math";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);
const NODATA = -32768;

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(request: NextRequest) {
  let body: {
    lat1?: number;
    lon1?: number;
    lat2?: number;
    lon2?: number;
    num_points?: number;
    zoom?: number;
  };
  try {
    body = await request.json();
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

    const { x: cx, y: cy } = latLonToTile(midLat, midLon, z);
    const xFrac = ((midLon + 180) / 360) * 2 ** z - cx;
    const latRad = (midLat * Math.PI) / 180;
    const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z - cy;

    // Load tiles around the line — estimate coverage from endpoints
    const maxDist = Math.sqrt((lat2 - lat1) ** 2 + (lon2 - lon1) ** 2);
    const radius = Math.max(10, Math.min(200, Math.ceil((maxDist / cellSizeDeg) * 2)));

    const gridRows = 2 * radius + 1;
    const gridCols = 2 * radius + 1;

    const centerPixelX = cx * 256 + xFrac * 256;
    const centerPixelY = cy * 256 + yFrac * 256;
    const minPixelX = Math.floor(centerPixelX - radius);
    const minPixelY = Math.floor(centerPixelY - radius);

    const tileXMin = Math.floor(minPixelX / 256);
    const tileXMax = Math.floor((minPixelX + gridCols - 1) / 256);
    const tileYMin = Math.floor(minPixelY / 256);
    const tileYMax = Math.floor((minPixelY + gridRows - 1) / 256);

    const tileDataMap = new Map<string, Int16Array>();
    for (let ty = tileYMin; ty <= tileYMax; ty++) {
      for (let tx = tileXMin; tx <= tileXMax; tx++) {
        const key = `${tx}/${ty}`;
        try {
          const tile = await getTileData(z, tx, ty, HF_BACKEND);
          tileDataMap.set(key, tile.data);
        } catch {
          /* unavailable */
        }
      }
    }

    function sampleElevation(lat: number, lon: number): number {
      const n2 = 2 ** z;
      const tileX = Math.floor(((lon + 180) / 360) * n2);
      const latRad2 = (lat * Math.PI) / 180;
      const tileY = Math.floor(((1 - Math.log(Math.tan(latRad2) + 1 / Math.cos(latRad2)) / Math.PI) / 2) * n2);
      const key = `${tileX}/${tileY}`;
      const tile = tileDataMap.get(key);
      if (!tile) return NODATA;

      const px = ((lon + 180) / 360) * n2 * 256 - tileX * 256;
      const py = ((1 - Math.log(Math.tan(latRad2) + 1 / Math.cos(latRad2)) / Math.PI) / 2) * n2 * 256 - tileY * 256;
      const x0 = Math.max(0, Math.min(255, Math.floor(px)));
      const y0 = Math.max(0, Math.min(255, Math.floor(py)));
      const x1 = Math.min(255, x0 + 1);
      const y1 = Math.min(255, y0 + 1);
      const fx = px - x0,
        fy = py - y0;

      const h00 = tile[y0 * 256 + x0];
      const h10 = tile[y0 * 256 + x1];
      const h01 = tile[y1 * 256 + x0];
      const h11 = tile[y1 * 256 + x1];

      if (h00 === NODATA && h10 === NODATA && h01 === NODATA && h11 === NODATA) return NODATA;
      return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
    }

    // Haversine distance helper
    function haversineDistance(latA: number, lonA: number, latB: number, lonB: number): number {
      const R = 6371000;
      const dLat = ((latB - latA) * Math.PI) / 180;
      const dLon = ((lonB - lonA) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((latA * Math.PI) / 180) * Math.cos((latB * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Generate evenly-spaced profile points
    const profile: { distance_m: number; elevation: number; lat: number; lon: number }[] = [];
    let totalDist = 0;

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const ptLat = lat1 + (lat2 - lat1) * t;
      const ptLon = lon1 + (lon2 - lon1) * t;
      const elev = sampleElevation(ptLat, ptLon);

      if (i > 0) {
        totalDist += haversineDistance(profile[i - 1].lat, profile[i - 1].lon, ptLat, ptLon);
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
                  (_, i) => i > 0 && profile[i].elevation > NODATA && profile[i].elevation > profile[i - 1].elevation,
                )
                .reduce(
                  (s, p, _, arr) =>
                    s + (p.elevation - (arr[Math.max(0, profile.indexOf(p) - 1)]?.elevation ?? p.elevation)),
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
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
