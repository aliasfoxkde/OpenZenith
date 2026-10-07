/**
 * Air quality API endpoint.
 *
 * Returns current air quality data as GeoJSON point features
 * from the Open-Meteo Air Quality API.
 */

import { NextResponse } from "next/server";
import { CORS_HEADERS, corsError, corsPreflightResponse } from "@/lib/cors";
import { apiCacheKey, edgeGetJson, edgePutJson } from "@/lib/storage/edge-cache";

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

/** One `current` block of the Open-Meteo Air Quality reply. */
interface OpenMeteoCurrent {
  pm10?: number;
  pm2_5?: number;
  carbon_monoxide?: number;
  nitrogen_dioxide?: number;
  sulphur_dioxide?: number;
  ozone?: number;
  us_aqi?: number;
  time?: string;
}

/** Open-Meteo Air Quality API reply — only `current` is read. */
interface OpenMeteoAirQuality {
  current?: OpenMeteoCurrent | null;
}

/**
 * Absent/empty param → the documented default; present but malformed or
 * out-of-range → null, which the caller reports as 400. Silently swapping a
 * typo'd coordinate for the default used to answer "air quality at 40.7,-74"
 * for any garbage input.
 */
function parseCoord(val: string | null, fallback: number, min: number, max: number): number | null {
  if (val === null || val === "") return fallback;
  const n = Number(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = parseCoord(url.searchParams.get("lat"), 40.7, -90, 90);
  const lon = parseCoord(url.searchParams.get("lon"), -74.0, -180, 180);
  if (lat === null || lon === null) {
    return NextResponse.json(
      { error: "Invalid lat/lon — expected numeric coordinates in range" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const cacheKey = apiCacheKey("airquality", { lat: lat.toFixed(2), lon: lon.toFixed(2) });
  try {
    const cached = await edgeGetJson(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300", "X-Cache": "HIT" },
      });
    }

    // Open-Meteo Air Quality API
    const aqUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    aqUrl.searchParams.set("latitude", lat.toString());
    aqUrl.searchParams.set("longitude", lon.toString());
    aqUrl.searchParams.set("current", "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi");
    aqUrl.searchParams.set("timezone", "auto");

    const res = await fetch(aqUrl.toString(), {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return corsError("Failed to fetch air quality data", 502);
    }

    const data = (await res.json()) as OpenMeteoAirQuality;
    const current = data.current;
    if (!current) {
      return NextResponse.json({ type: "FeatureCollection", features: [] }, { headers: CORS_HEADERS });
    }

    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: {
        pm2_5: current.pm2_5,
        pm10: current.pm10,
        co: current.carbon_monoxide,
        no2: current.nitrogen_dioxide,
        so2: current.sulphur_dioxide,
        o3: current.ozone,
        us_aqi: current.us_aqi,
        time: current.time,
        aqi_level: getAqiLevel(current.us_aqi || 0),
      },
    };

    const result = { type: "FeatureCollection", features: [feature] };
    edgePutJson(cacheKey, result, 300).catch(() => {});
    return NextResponse.json(result, {
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300", "X-Cache": "MISS" },
    });
  } catch {
    return corsError("Internal server error", 500);
  }
}

function getAqiLevel(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}
