import { NextRequest, NextResponse } from "next/server";

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
    // Query the existing elevation endpoint to determine land vs ocean
    const elevUrl = `/api/elevation?lat=${latNum}&lon=${lonNum}`;
    const elevRes = await fetch(new URL(elevUrl, request.url));
    const elevData = await elevRes.json();

    if (elevData.elevation !== null && elevData.elevation !== undefined) {
      // Land point — return land elevation
      return NextResponse.json(
        {
          depth: null,
          elevation: elevData.elevation,
          unit: "meters",
          surface_type: "land",
          source: elevData.source || "srtm30m",
          location: { lat: latNum, lon: lonNum },
        },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" } },
      );
    }

    // Ocean point — return depth estimate
    // For now, use a simple estimate. Full GEBCO integration comes in Phase A4.
    // Open-sea average depth is ~3688m. Coastal areas are shallower.
    // This placeholder will be replaced with actual GEBCO data.
    return NextResponse.json(
      {
        depth: null,
        elevation: null,
        unit: "meters",
        surface_type: "ocean",
        source: null,
        note: "Bathymetry data not yet available. Full GEBCO 2024 integration pending.",
        location: { lat: latNum, lon: lonNum },
      },
      { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=86400" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Bathymetry query failed" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
