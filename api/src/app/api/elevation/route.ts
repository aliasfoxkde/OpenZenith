/**
 * Point elevation query.
 *
 * GET /api/elevation?lat=&lon= - elevation in meters plus the source that
 * answered (ozt2 | merged | gebco), surface_type and resolution. Sources are
 * tried in order: OZT2 z10 tiles on HuggingFace, then merged SRTM chunks,
 * then GEBCO for bathymetry.
 *
 * Optional query params:
 * - interpolation=nearest|bilinear (default bilinear — the OZT2 source has
 *   always blended four pixels; `nearest` reads the one pixel under the
 *   point). The merged-chunk fallback and GEBCO sample nearest regardless.
 * - units=meters|feet (default meters). `elevation` is converted; the raw
 *   sample stays available as metadata.elevation_m.
 * - datum=egm96|ellipsoid (default egm96). SRTM heights are EGM96
 *   orthometric, so the default is the identity; `ellipsoid` returns
 *   h = H + N using the bundled EGM96 grid.
 *
 * Every response carries a `metadata` object echoing the effective options
 * alongside the source and its approximate ground sampling.
 *
 * Caching: Workers Cache API keyed to 7 decimal places, success-only, held
 * for 86400s; the cached entry is the raw source sample, and the
 * units/datum presentation is applied per request, so one cached sample
 * serves every parameter combination. Responses set Cache-Control: public,
 * max-age=3600 and an X-Cache: HIT|MISS marker.
 */
import { NextRequest, NextResponse } from "next/server";
import { getPointElevation } from "@/lib/point-elevation";
import { HuggingFaceChunkBackend, OZT2HuggingFaceBackend } from "@/lib/storage/backend";
import { getGebcoElevation } from "@/lib/gebco/cog-reader";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { edgeGetJson, edgePutJson } from "@/lib/storage/edge-cache";
import {
  parseElevationParams,
  presentElevation,
  type ElevationParams,
  type ElevationUnits,
  type Interpolation,
} from "@/lib/elevation-params";

export const runtime = "edge";

// OZT2 backend (primary) — z10 tiles from HuggingFace, falls back to merged chunks
const OZT2_BACKEND = new OZT2HuggingFaceBackend({
  repoId: "aliasfox/srtm30m-ozt2-v2",
  fallbackRepoId: "aliasfox/srtm30m-merged",
  zoom: 10,
});

// Merged chunk backend (fallback / direct SRTM chunk access)
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

async function getElevation(lat: number, lon: number, interpolation: Interpolation) {
  // 1. Try OZT2 tiles (primary) — z10 from HuggingFace
  try {
    const elevation = await OZT2_BACKEND.getElevation(lat, lon, interpolation);
    if (elevation !== null) {
      return {
        elevation,
        surface_type: "land" as const,
        unit: "meters" as const,
        location: { lat, lon },
        source: "ozt2" as const,
        tile: "",
        resolution: 30,
      };
    }
  } catch {
    // Fall through to merged chunks
  }

  // 2. Try merged chunks (fallback for tiles not yet in OZT2 dataset)
  try {
    const result = await getPointElevation(lat, lon, HF_BACKEND);
    if (result) {
      return {
        elevation: result.elevation,
        surface_type: result.surfaceType,
        unit: "meters" as const,
        location: { lat, lon },
        source: "huggingface" as const,
        tile: result.tile,
        resolution: 30,
      };
    }
  } catch {
    // Fall through to GEBCO
  }

  // 3. GEBCO 2025 for ocean / outside SRTM coverage
  try {
    const gebco = await getGebcoElevation(lat, lon);
    if (gebco.elevation !== null) {
      return {
        elevation: gebco.elevation,
        surface_type: gebco.surface_type,
        unit: "meters" as const,
        location: { lat, lon },
        source: "gebco2025" as const,
        tile: gebco.tile,
        resolution: 450,
      };
    }
  } catch {
    // All sources failed
  }

  return {
    elevation: null,
    surface_type: "unknown" as const,
    unit: "meters" as const,
    location: { lat, lon },
    source: "none" as const,
    tile: "",
    resolution: 0,
  };
}

export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Which sampling a source actually applied.
 *
 * `bilinear` only holds for the OZT2 tile path: the merged-chunk fallback
 * reads one pixel of a chunk crop (its neighbours can sit in an unfetched
 * chunk) and GEBCO reads one pixel of a 15-arc-second strip, so both report
 * `nearest` even when bilinear was requested.
 */
function effectiveInterpolation(source: string, requested: Interpolation): Interpolation {
  return source === "ozt2" ? requested : "nearest";
}

/** Raw source sample as stored in the edge cache — units and datum unset. */
type RawSample = Awaited<ReturnType<typeof getElevation>>;

/** Additive response metadata: effective options plus the raw sample. */
function buildMetadata(result: RawSample, undulation: number, params: ElevationParams) {
  return {
    resolution_m: result.resolution,
    vertical_datum: params.datum,
    interpolation: effectiveInterpolation(result.source, params.interpolation),
    units: params.units,
    source: result.source,
    // Raw sample, kept in EGM96 orthometric metres whatever the request asked
    // for, so a `feet`+`ellipsoid` response can always be re-derived.
    elevation_m: result.elevation,
    // Undulation used for the conversion (0 when it was not applied) — enough
    // to audit an ellipsoidal answer without a second lookup.
    geoid_undulation_m: params.datum === "ellipsoid" ? undulation : 0,
  };
}

/**
 * Apply the requested datum and unit to a raw source sample.
 *
 * The geoid grid is only imported on the `ellipsoid` path — the default
 * `egm96` request is the identity, and paying ~360 KB of payload decode for
 * it would be pure overhead.
 */
async function presentResult(
  result: RawSample,
  params: ElevationParams,
): Promise<{ elevation: number | null; unit: ElevationUnits; undulation: number }> {
  if (result.elevation === null) return { elevation: null, unit: params.units, undulation: 0 };

  if (params.datum === "ellipsoid") {
    const { egm96UndulationAt } = await import("@/lib/egm96");
    const undulation = await egm96UndulationAt(result.location.lat, result.location.lon);
    return { elevation: presentElevation(result.elevation, undulation, params), unit: params.units, undulation };
  }
  return { elevation: presentElevation(result.elevation, 0, params), unit: params.units, undulation: 0 };
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? `oz-${Date.now().toString(36)}`;
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");

  if (!latStr || !lonStr) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PARAM", message: "Missing required parameters: lat, lon" }, requestId },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_COORDS", message: "Invalid coordinates. lat must be -90..90, lon must be -180..180" },
        requestId,
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const params = parseElevationParams(searchParams);
  if (!params.ok) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_PARAM", message: params.message }, requestId },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    // Edge Cache API in front of the elevation sources: point queries repeat
    // heavily (popular summits, SDK retries, map pin re-reads) and worker
    // responses are not CDN-cached on Pages. Success-only — a no-data sample
    // may be a transient source outage, not a property of the coordinate.
    const cacheKey = `api/elevation?lat=${lat.toFixed(7)}&lon=${lon.toFixed(7)}`;
    const cached = await edgeGetJson<Record<string, unknown>>(cacheKey);
    if (cached) {
      // The cache holds the raw sample, so the requested presentation is
      // applied here exactly as it would have been on a miss.
      const presented = await presentResult(cached as RawSample, params.params);
      return NextResponse.json(
        {
          requestId,
          ...cached,
          elevation: presented.elevation,
          unit: presented.unit,
          metadata: buildMetadata(cached as RawSample, presented.undulation, params.params),
          ok: true as const,
        },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600", "X-Cache": "HIT" } },
      );
    }

    const result = await getElevation(lat, lon, params.params.interpolation);
    if (result.elevation !== null) {
      await edgePutJson(cacheKey, result, 86400);
    }
    const presented = await presentResult(result, params.params);
    const payload = {
      requestId,
      ...result,
      // Raw source keys above, then the requested presentation on top — the
      // spread order is what keeps `elevation`/`unit` honouring the query.
      elevation: presented.elevation,
      unit: presented.unit,
      metadata: buildMetadata(result, presented.undulation, params.params),
      ...(result.elevation === null
        ? {
            ok: false as const,
            error: {
              code: "ELEVATION_NO_DATA",
              message: "No elevation source returned a valid sample",
              retryable: true,
            },
          }
        : { ok: true as const }),
    };

    return NextResponse.json(payload, {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=3600",
        "X-Cache": "MISS",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: { code: "ELEVATION_UNAVAILABLE", message, retryable: true }, requestId },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}
