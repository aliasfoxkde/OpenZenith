import { NextRequest, NextResponse } from "next/server";
import { getElevationFromR2 } from "@/lib/elevation/terrarium-reader";
import { getGebcoElevation } from "@/lib/gebco/cog-reader";

export const runtime = "edge";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "Missing required parameters: lat and lon" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const latNum = Number(lat);
  const lonNum = Number(lon);

  if (isNaN(latNum) || isNaN(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    return NextResponse.json(
      { error: "Invalid coordinates. lat must be -90..90, lon must be -180..180" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    // Try SRTM (land elevation) first
    const result = await getElevationFromR2(latNum, lonNum);

    if (result.elevation !== null) {
      const isOcean = result.elevation < -0.5;
      return NextResponse.json(
        {
          depth: isOcean ? Math.abs(result.elevation) : 0,
          elevation: isOcean ? 0 : result.elevation,
          unit: "meters",
          surface_type: result.surface_type,
          source: result.source,
          tile: result.tile,
          resolution: result.resolution,
          location: { lat: latNum, lon: lonNum },
        },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" } },
      );
    }

    // SRTM returned null (ocean or outside coverage) — fall back to GEBCO 2025
    let gebco;
    try {
      gebco = await getGebcoElevation(latNum, lonNum);
    } catch {
      // GEBCO fetch failed (e.g. Workers memory limit on deep range requests)
      gebco = null;
    }

    if (gebco && gebco.elevation !== null) {
      const isOcean = gebco.elevation < -0.5;
      return NextResponse.json(
        {
          depth: isOcean ? Math.abs(gebco.elevation) : 0,
          elevation: isOcean ? 0 : gebco.elevation,
          unit: "meters",
          surface_type: gebco.surface_type,
          source: gebco.source,
          tile: gebco.tile,
          resolution: gebco.resolution,
          location: { lat: latNum, lon: lonNum },
        },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" } },
      );
    }

    // Both sources returned null
    return NextResponse.json(
      {
        depth: null,
        elevation: null,
        unit: "meters",
        surface_type: "unknown",
        source: "none",
        tile: "",
        location: { lat: latNum, lon: lonNum },
      },
      { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bathymetry query failed";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
