import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsError, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

function parseCoord(val: string | null, fallback: number, min: number, max: number): number {
  if (!val) return fallback;
  const n = Number(val);
  return isNaN(n) || n < min || n > max ? fallback : n;
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
  const lat = parseCoord(searchParams.get("lat"), 30, -90, 90);
  const lon = parseCoord(searchParams.get("lon"), -90, -180, 180);
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
        return Response.json(
          { error: "ADSB Exchange requires API key", ac: [] },
          { status: 200, headers: CORS_HEADERS },
        );
      }
      return corsError(`ADSB Exchange returned ${resp.status}`, 502);
    }

    const data = await resp.json();

    return NextResponse.json(data, {
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=15" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Military flight fetch failed";
    return Response.json({ error: message, ac: [] }, { status: 502, headers: CORS_HEADERS });
  }
}
