import { NextRequest, NextResponse } from "next/server";
import { getPointElevation } from "@/lib/point-elevation";
import { HuggingFaceChunkBackend, LOCAL_BACKEND } from "@/lib/storage/backend";
import { getGebcoElevation } from "@/lib/gebco/cog-reader";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

// Try local .tif files first (100x faster than HTTPS), fall back to HuggingFace
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

async function getElevation(lat: number, lon: number) {
  // Try local SRTM .tif files first (zero network overhead)
  try {
    const result = await getPointElevation(lat, lon, LOCAL_BACKEND);
    if (result) {
      return {
        elevation: result.elevation,
        surface_type: result.surfaceType,
        unit: "meters" as const,
        location: { lat, lon },
        source: "local" as const,
        tile: result.tile,
        resolution: 30,
      };
    }
  } catch {
    // Fall through to HuggingFace
  }

  // Fall back to HuggingFace merged chunks
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

  // GEBCO 2025 for ocean / outside SRTM coverage
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
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");

  if (!latStr || !lonStr) {
    return NextResponse.json(
      { error: "Missing required parameters: lat, lon" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json(
      { error: "Invalid coordinates. lat must be -90..90, lon must be -180..180" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const result = await getElevation(lat, lon);

    return NextResponse.json(result, {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
