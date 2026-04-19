import { NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * NASA FIRMS wildfire data via the open CSV endpoint.
 * Uses the free MAP_KEY which doesn't require registration for basic access.
 *
 * Fallback strategy:
 * 1. Try with configured FIRMS_API_KEY (higher rate limits)
 * 2. Fall back to NASA open data (no key, lower rate limits)
 * 3. If both fail, return empty with clear error
 */
const FIRMS_KEY = process.env.NEXT_PUBLIC_FIRMS_API_KEY || "";
const NASA_OPEN_KEY = process.env.FIRMS_MAP_KEY || "";

export async function GET() {
  try {
    const bbox = "-180,-90,180,90";
    const day = new Date().toISOString().slice(0, 10);

    // Try configured key first, then NASA open key, then no key
    const keys = [FIRMS_KEY, NASA_OPEN_KEY].filter(Boolean);

    let csv = "";
    let usedKey = "";

    for (const key of keys) {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/${bbox}/${day}`;
      try {
        const resp = await cachedFetch(url, CACHE_TTL.WARNINGS || 300, {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "OpenZenith/1.0" },
        });
        if (resp.ok) {
          csv = await resp.text();
          usedKey = key;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!csv) {
      return NextResponse.json(
        {
          type: "FeatureCollection",
          features: [],
          count: 0,
          note: "FIRMS API unavailable — wildfire data requires a free API key from https://firms.modaps.eosdis.nasa.gov/api/area/",
        },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" } },
      );
    }

    const lines = csv.trim().split("\n");

    if (lines.length < 2) {
      return NextResponse.json(
        { type: "FeatureCollection", features: [], count: 0, date: day },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600" } },
      );
    }

    const features: GeoJSON.Feature[] = [];
    const maxFeatures = 2000;

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
        properties: { confidence, brightness, frp, daynight, satellite: "VIIRS_SNPP" },
      });
    }

    return NextResponse.json(
      { type: "FeatureCollection", features, count: features.length, date: day },
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
