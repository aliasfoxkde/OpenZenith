import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";

export const runtime = "edge";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Military flight data — proxies to ADSB Exchange to avoid CORS.
 *
 * Parameters:
 *   lat  - Center latitude (default: 30)
 *   lon  - Center longitude (default: -90)
 *   dist - Radius in nautical miles (default: 500, max: 1000)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat") || "30";
  const lon = searchParams.get("lon") || "-90";
  const dist = Math.min(Number(searchParams.get("dist")) || 500, 1000);

  try {
    const url = `https://adsbexchange.com/api/aircraft/v2/lat/${lat}/lon/${lon}/dist/${dist}`;
    const resp = await cachedFetch(url, CACHE_TTL.FLIGHTS, {
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/json",
        "User-Agent": "OpenZenith/1.0",
      },
    });

    if (!resp.ok) {
      if (resp.status === 402 || resp.status === 403) {
        return NextResponse.json(
          { error: "ADSB Exchange requires API key", ac: [] },
          { status: 200, headers: CORS_HEADERS },
        );
      }
      return NextResponse.json(
        { error: `ADSB Exchange returned ${resp.status}`, ac: [] },
        { status: 502, headers: CORS_HEADERS },
      );
    }

    const data = await resp.json();

    return NextResponse.json(data, {
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=15" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Military flight fetch failed";
    return NextResponse.json(
      { error: message, ac: [] },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}
