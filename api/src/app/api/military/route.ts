import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { r2GetJson, r2PutJson, apiCacheKey } from "@/lib/storage/r2-json-cache";

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
 * NOTE: ADSB Exchange requires a paid subscription for API access.
 * Without an API key, the endpoint returns limited/no data.
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
    // Try R2 cache first (ADSB Exchange is paid-only, cache what we get)
    const cacheKey = apiCacheKey("military", { lat: String(lat), lon: String(lon), dist: String(dist) });
    const cached = await r2GetJson(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=30", "X-Cache": "HIT" },
      });
    }

    const url = `https://adsbexchange.com/api/aircraft/v2/lat/${lat}/lon/${lon}/dist/${dist}`;
    const resp = await cachedFetch(url, CACHE_TTL.FLIGHTS, {
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/json",
        "User-Agent": "OpenZenith/1.0",
      },
    });

    if (!resp.ok) {
      const status = resp.status;
      let errorMsg = `ADSB Exchange returned ${status}`;

      if (status === 402 || status === 403) {
        errorMsg = "ADSB Exchange requires API key — subscription needed at https://adsbexchange.com/data/";
      } else if (status === 429) {
        errorMsg = "ADSB Exchange rate limit exceeded — try again later";
      }

      return NextResponse.json(
        { error: errorMsg, ac: [], count: 0 },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    const data = await resp.json();

    // Handle various response formats
    const aircraft = data?.ac || data?.aircraft || data?.results || [];

    const result = {
      ac: aircraft,
      count: Array.isArray(aircraft) ? aircraft.length : 0,
      total: data?.totalCount ?? data?.total ?? null,
    };
    r2PutJson(cacheKey, result, 60).catch(() => {});
    return NextResponse.json(result, {
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=30", "X-Cache": "MISS" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Military flight fetch failed";
    return NextResponse.json(
      { error: message, ac: [], count: 0 },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}
