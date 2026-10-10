/**
 * Batch elevation endpoint (edge-compatible).
 *
 * Accepts multiple lat/lon points and returns elevations in a single request.
 * Uses HuggingFace merged chunks for edge deployment.
 *
 * POST /api/elevation/batch?units=feet&datum=ellipsoid&interpolation=nearest
 * Body: { points: [{lat, lon, id?}, ...] }
 * Response: { results: [{lat, lon, elevation, elevation_m, id?}, ...], metadata }
 *
 * Query params match /api/elevation: `interpolation` (default bilinear, the
 * sampling this endpoint has always used), `units` (default meters) and
 * `datum` (default egm96 — SRTM heights are already EGM96 orthometric, so
 * `ellipsoid` is what actually changes the value).
 */

import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";
import { latLonToTile } from "@/lib/srtm/zoom-math";
import { errorResponse } from "@/lib/api-response";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { parseElevationParams, presentElevation, type Interpolation } from "@/lib/elevation-params";

export const runtime = "edge";

// HuggingFace backend (edge-compatible)
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

// Source DEM ground sampling — the z12 tile grid is built from 30 m SRTM.
const BATCH_RESOLUTION_M = 30;

export function OPTIONS() {
  return corsPreflightResponse();
}

interface BatchPoint {
  lat: number;
  lon: number;
  id?: string;
}

interface BatchResult {
  id?: string;
  lat: number;
  lon: number;
  elevation: number | null;
  /** Raw EGM96 orthometric sample, unaffected by `units`/`datum`. */
  elevation_m: number | null;
}

/** Client request body. Every field is validated explicitly after parsing. */
interface BatchRequestBody {
  points?: BatchPoint[];
}

function sampleElevation(
  tileData: { data: Int16Array; width: number; height: number },
  lat: number,
  lon: number,
  zoom: number,
  interpolation: Interpolation,
): number | null {
  const { x, y } = latLonToTile(lat, lon, zoom);
  const n = 2 ** zoom;
  const xFrac = ((lon + 180) / 360) * n - x;
  const latRad = (lat * Math.PI) / 180;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - y;

  const w = tileData.width;
  const h = tileData.height;
  const px = xFrac * (w - 1);
  const py = yFrac * (h - 1);

  if (interpolation === "nearest") {
    // Rounding can reach w/h at the far edge, which is out of bounds.
    // bounds: the Math.min guards clamp the index to [0, (h-1)*w + w-1] for
    // in-range lat/lon; an exact-pole lat can still land outside and yield
    // undefined — preserved as-is (pre-existing far-edge behavior).
    const value = tileData.data[Math.min(h - 1, Math.round(py)) * w + Math.min(w - 1, Math.round(px))]!;
    return value === -32768 ? null : value;
  }

  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = px - x0;
  const fy = py - y0;

  // bounds: x1/y1 are clamped to w-1/h-1 and x0/y0 stay in range for in-range
  // lat/lon; an exact-pole lat can still push y0 outside and yield undefined —
  // preserved as-is (pre-existing far-edge NaN).
  const h00 = tileData.data[y0 * w + x0]!;
  const h10 = tileData.data[y0 * w + x1]!;
  const h01 = tileData.data[y1 * w + x0]!;
  const h11 = tileData.data[y1 * w + x1]!;

  if (h00 === -32768 && h10 === -32768 && h01 === -32768 && h11 === -32768) {
    return null;
  }

  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

export async function POST(request: NextRequest) {
  const params = parseElevationParams(request.nextUrl.searchParams);
  if (!params.ok) {
    return NextResponse.json({ error: params.message }, { status: 400, headers: CORS_HEADERS });
  }

  let body: BatchRequestBody;
  try {
    body = (await request.json()) as BatchRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: CORS_HEADERS });
  }

  const points = body.points;
  if (!Array.isArray(points) || points.length === 0 || points.length > 2000) {
    return NextResponse.json(
      { error: "Provide 1-2000 points as {points: [{lat, lon}]}" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  for (const p of points) {
    if (
      typeof p.lat !== "number" ||
      typeof p.lon !== "number" ||
      isNaN(p.lat) ||
      isNaN(p.lon) ||
      p.lat < -90 ||
      p.lat > 90 ||
      p.lon < -180 ||
      p.lon > 180
    ) {
      return NextResponse.json(
        { error: "Each point must have valid lat (-90..90) and lon (-180..180)" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
  }

  try {
    const zoom = 12;
    // The geoid grid is only paid for when a caller actually asked for
    // ellipsoidal heights; `egm96` (the default) is the identity.
    const egm96 = params.params.datum === "ellipsoid" ? await import("@/lib/egm96") : null;
    const results: BatchResult[] = new Array<BatchResult>(points.length);
    const tileCache = new Map<string, { data: Int16Array; width: number; height: number } | null>();

    const tileGroups = new Map<string, number[]>();
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!; // bounds: i < points.length
      const { x, y } = latLonToTile(p.lat, p.lon, zoom);
      const key = `${x}/${y}`;
      const group = tileGroups.get(key);
      if (group) {
        group.push(i);
      } else {
        tileGroups.set(key, [i]);
      }
    }

    for (const [tileKey, indices] of tileGroups) {
      if (!tileCache.has(tileKey)) {
        try {
          // bounds: tileKey is "<int>/<int>" so split always yields both parts
          const x = Number(tileKey.split("/")[0]!);
          const y = Number(tileKey.split("/")[1]!);
          const tileData = await getTileData(zoom, x, y, HF_BACKEND);
          tileCache.set(tileKey, tileData);
        } catch {
          tileCache.set(tileKey, null);
        }
      }

      const tileData = tileCache.get(tileKey);
      for (const idx of indices) {
        const p = points[idx]!; // bounds: indices were collected from i < points.length
        const raw = tileData ? sampleElevation(tileData, p.lat, p.lon, zoom, params.params.interpolation) : null;
        // `raw` carries the 0.1 m rounding the endpoint has always applied.
        const elevation_m = raw !== null ? Math.round(raw * 10) / 10 : null;
        // The grid is resident after the first lookup, so an await per point is
        // a microtask, not a decode.
        const undulation = elevation_m === null || !egm96 ? 0 : await egm96.egm96UndulationAt(p.lat, p.lon);
        results[idx] = {
          id: p.id,
          lat: p.lat,
          lon: p.lon,
          elevation: elevation_m === null ? null : presentElevation(elevation_m, undulation, params.params),
          elevation_m,
        };
      }
    }

    const metadata = {
      resolution_m: BATCH_RESOLUTION_M,
      vertical_datum: params.params.datum,
      interpolation: params.params.interpolation,
      units: params.params.units,
      source: "huggingface",
    };

    return NextResponse.json(
      { results, metadata },
      { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" } },
    );
  } catch (err) {
    return errorResponse(err, 500);
  }
}
