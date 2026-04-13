import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");
  const zoom = request.nextUrl.searchParams.get("zoom") || "18";

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
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latNum}&lon=${lonNum}&zoom=${zoom}&addressdetails=1`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "OpenZenith/1.0 (geospatial platform)" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Upstream geocoding service unavailable" },
        { status: 502, headers: CORS_HEADERS },
      );
    }

    const data = (await res.json()) as Record<string, unknown>;

    if (data.error) {
      return NextResponse.json(
        { place: null, location: { lat: latNum, lon: lonNum } },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } },
      );
    }

    return NextResponse.json(
      {
        place: {
          display_name: data.display_name,
          name: data.name || (data.display_name as string)?.split(",")[0],
          type: data.type,
          address: data.address,
          osm_id: data.osm_id,
          osm_type: data.osm_type,
        },
        location: { lat: latNum, lon: lonNum },
      },
      { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    return NextResponse.json({ error: "Reverse geocoding request failed" }, { status: 500, headers: CORS_HEADERS });
  }
}
