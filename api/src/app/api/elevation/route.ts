import { NextRequest, NextResponse } from "next/server";
import { getPointElevation } from "@/lib/point-elevation";
import { HuggingFaceChunkBackend, OZT2HuggingFaceBackend } from "@/lib/storage/backend";
import { getGebcoElevation } from "@/lib/gebco/cog-reader";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

// OZT2 backend (primary) — z10 tiles from HuggingFace, falls back to merged chunks
const OZT2_BACKEND = new OZT2HuggingFaceBackend({
  repoId: "aliasfox/srtm30m-ozt2-v2",
  fallbackRepoId: "aliasfox/srtm30m-merged",
  zoom: 10,
});

// Merged chunk backend (fallback / direct SRTM chunk access)
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

async function getElevation(lat: number, lon: number) {
  // 1. Try OZT2 tiles (primary) — z10 from HuggingFace
  try {
    const elevation = await OZT2_BACKEND.getElevation(lat, lon);
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

export async function OPTIONS() {
  return corsPreflightResponse();
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

  try {
    const result = await getElevation(lat, lon);
    const payload = {
      requestId,
      ...result,
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
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: { code: "ELEVATION_UNAVAILABLE", message, retryable: true }, requestId },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}
