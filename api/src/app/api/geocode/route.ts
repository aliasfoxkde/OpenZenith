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
  const query = request.nextUrl.searchParams.get("query");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 5, 10);

  if (!query) {
    return NextResponse.json(
      { error: "Missing required parameter: query" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "OpenZenith/1.0 (geospatial platform)" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Upstream geocoding service unavailable" },
        { status: 502, headers: CORS_HEADERS },
      );
    }

    const data = await res.json();

    return NextResponse.json(
      {
        results: data.map((r: Record<string, unknown>) => ({
          display_name: r.display_name,
          lat: Number(r.lat),
          lon: Number(r.lon),
          type: r.type,
          importance: r.importance,
          address: r.address,
        })),
        count: data.length,
      },
      { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Geocoding request failed" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
