import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * NASA FIRMS wildfire data via CSV endpoint.
 *
 * Uses FIRMS_MAP_KEY (set via wrangler pages secret or .env.local).
 * Rate limit: 5000 transactions per 10 minutes.
 *
 * Parameters:
 *   days  - Number of days back (default: 1, max: 7)
 *   bbox  - Bounding box "lon_min,lat_min,lon_max,lat_max" (default: global)
 *   satellite - VIIRS_SNPP_NRT | VIIRS_NOAA20_NRT | MODIS_NRT (default: VIIRS_SNPP_NRT)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(Number(searchParams.get("days")) || 1, 7);
    const bbox = searchParams.get("bbox") || "-180,-90,180,90";
    const satellite = searchParams.get("satellite") || "VIIRS_SNPP_NRT";

    const apiKey = process.env.FIRMS_MAP_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          type: "FeatureCollection",
          features: [],
          count: 0,
          error: "FIRMS_MAP_KEY not configured",
        },
        { status: 200, headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" } },
      );
    }

    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${satellite}/${bbox}/${days}`;

    const resp = await cachedFetch(url, CACHE_TTL.WARNINGS || 300, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!resp.ok) {
      const statusText = await resp.text().catch(() => "");
      return NextResponse.json(
        {
          type: "FeatureCollection",
          features: [],
          count: 0,
          error: `FIRMS API returned ${resp.status}: ${statusText.slice(0, 100)}`,
        },
        { status: 200, headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=60" } },
      );
    }

    const csv = await resp.text();
    const lines = csv.trim().split("\n");

    if (lines.length < 2) {
      return NextResponse.json(
        { type: "FeatureCollection", features: [], count: 0, days, bbox, satellite, date: new Date().toISOString().slice(0, 10) },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } },
      );
    }

    const features: GeoJSON.Feature[] = [];
    const maxFeatures = 3000;

    for (let i = 1; i < lines.length && i <= maxFeatures; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 10) continue;

      const lat = parseFloat(cols[0]);
      const lon = parseFloat(cols[1]);
      const brightness = parseFloat(cols[2]) || 0;
      const confidence = parseFloat(cols[9]);
      const frp = parseFloat(cols[13]) || 0;
      const daynight = (cols[14] || "D").trim();

      if (isNaN(lat) || isNaN(lon)) continue;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { confidence, brightness, frp, daynight, satellite },
      });
    }

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        count: features.length,
        days,
        bbox,
        satellite,
        date: new Date().toISOString().slice(0, 10),
        apiKeyStatus: "configured",
      },
      { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch FIRMS data";
    return NextResponse.json(
      { type: "FeatureCollection", features: [], count: 0, error: message },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}
