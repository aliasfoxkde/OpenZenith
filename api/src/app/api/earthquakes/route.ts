/**
 * USGS earthquake feed proxy.
 *
 * GET /api/earthquakes?period=<all_hour|all_day|...|1.0_month> - relays the
 * USGS summary GeoJSON document verbatim for the requested period.
 * Caching: Workers Cache API keyed by period plus an in-flight coalescing
 * fetch; Cache-Control: public, max-age=60 (CACHE_TTL.EARTHQUAKES), with an
 * X-Cache: HIT|MISS marker.
 */
import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { edgeGetJson, edgePutJson, apiCacheKey } from "@/lib/storage/edge-cache";

export const runtime = "edge";

const VALID_PERIODS = new Set([
  "all_hour",
  "all_day",
  "all_week",
  "all_month",
  "significant_hour",
  "significant_day",
  "significant_week",
  "significant_month",
  "significant_year",
  "4.5_hour",
  "4.5_day",
  "4.5_week",
  "4.5_month",
  "2.5_hour",
  "2.5_day",
  "2.5_week",
  "2.5_month",
  "1.0_hour",
  "1.0_day",
  "1.0_week",
  "1.0_month",
]);

export function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "all_day";

  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { error: `Invalid period. Valid: ${[...VALID_PERIODS].join(", ")}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    // Try R2 cache first (cross-isolate persistence)
    const cacheKey = apiCacheKey("earthquakes", { period });
    const cached = await edgeGetJson(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": `public, max-age=${CACHE_TTL.EARTHQUAKES}`,
          "X-Cache": "HIT",
        },
      });
    }

    const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${period}.geojson`;
    const resp = await cachedFetch(url, CACHE_TTL.EARTHQUAKES, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `USGS API returned ${resp.status}` }, { status: 502, headers: CORS_HEADERS });
    }

    // USGS GeoJSON is relayed verbatim — `unknown` is the honest boundary type.
    const data: unknown = await resp.json();

    // Store in R2 for future requests (best-effort)
    edgePutJson(cacheKey, data, CACHE_TTL.EARTHQUAKES).catch(() => {});

    return NextResponse.json(data, {
      headers: { ...CORS_HEADERS, "Cache-Control": `public, max-age=${CACHE_TTL.EARTHQUAKES}`, "X-Cache": "MISS" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Earthquake data fetch failed";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
