import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? `oz-${Date.now().toString(36)}`;
  const query = request.nextUrl.searchParams.get("query")?.trim();
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 10)) : 5;

  if (!query || query.length > 200) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PARAM", message: "Missing or invalid parameter: query" },
        requestId,
        results: [],
        count: 0,
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "OpenZenith/1.0 (geospatial platform)" },
    });

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after") ?? "5";
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "GEOCODE_RATE_LIMITED",
            message: "Rate limit exceeded. Slow down requests.",
            retryable: true,
            retryAfter: Number(retryAfter),
          },
          requestId,
          results: [],
          count: 0,
        },
        { status: 200, headers: { ...CORS_HEADERS, "Retry-After": retryAfter } },
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "GEOCODE_UPSTREAM", message: "Upstream geocoding service unavailable", retryable: true },
          requestId,
          results: [],
          count: 0,
        },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    const data = (await res.json()) as Record<string, unknown>[];

    return NextResponse.json(
      {
        requestId,
        results: data.map((r) => ({
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
      {
        ok: false,
        error: { code: "GEOCODE_UNAVAILABLE", message: "Geocoding request failed", retryable: true },
        requestId,
        results: [],
        count: 0,
      },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}
