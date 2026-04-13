import { NextRequest, NextResponse } from "next/server";
import { getElevationFromR2 } from "@/lib/elevation/terrarium-reader";
import { getWeather } from "@/lib/weather/open-meteo";
import { getTides } from "@/lib/tides/noaa";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

const VALID_INCLUDES = ["elevation", "address", "weather", "tides", "waterways"] as const;
type IncludeType = (typeof VALID_INCLUDES)[number];

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Unified query endpoint.
 *
 * GET /api/query?lat=40.7&lon=-74.0
 * GET /api/query?lat=40.7&lon=-74.0&include=elevation,address,weather
 *
 * Parameters:
 *   lat, lon     - Required. Coordinates.
 *   include      - Comma-separated list of data to include.
 *                  Default: "elevation"
 *                  Available: elevation, address, weather, tides, waterways
 *   units        - Temperature units: "metric" (default) or "imperial"
 *   forecast_days - Weather forecast days (1-7, default: 3)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");
  const includeStr = searchParams.get("include") || "elevation";
  const units = searchParams.get("units") || "metric";
  const forecastDays = Math.min(Math.max(Number(searchParams.get("forecast_days")) || 3, 1), 7);

  if (!latStr || !lonStr) {
    return NextResponse.json(
      { error: "Missing required parameters: lat, lon" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json(
      { error: "Invalid coordinates. lat must be -90..90, lon must be -180..180" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const requestedIncludes = includeStr
    .split(",")
    .map((s) => s.trim().toLowerCase() as IncludeType)
    .filter((s): s is IncludeType => (VALID_INCLUDES as readonly string[]).includes(s));

  if (requestedIncludes.length === 0) {
    return NextResponse.json(
      { error: `Invalid include values. Available: ${VALID_INCLUDES.join(", ")}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const result: Record<string, unknown> = {
      location: { lat, lon },
      query: {
        includes: requestedIncludes,
        units,
        timestamp: new Date().toISOString(),
      },
    };

    const promises: Array<Promise<void>> = [];

    // --- Elevation (R2 terrarium tiles) ---
    if (requestedIncludes.includes("elevation")) {
      promises.push(
        (async () => {
          result.elevation = await getElevationFromR2(lat, lon);
        })(),
      );
    }

    // --- Address (reverse geocode) ---
    if (requestedIncludes.includes("address")) {
      promises.push(
        (async () => {
          try {
            const zoom = searchParams.get("address_zoom") || "18";
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=1`;
            const res = await fetch(url, {
              signal: AbortSignal.timeout(10000),
              headers: { "User-Agent": "OpenZenith/1.0 (geospatial platform)" },
            });
            if (res.ok) {
              const data = (await res.json()) as Record<string, unknown>;
              if (data.error) {
                result.address = null;
              } else {
                result.address = {
                  display_name: data.display_name || null,
                  name: data.name || (data.display_name as string)?.split(",")[0] || null,
                  type: data.type || null,
                  address: data.address || null,
                  osm_id: data.osm_id || null,
                  osm_type: data.osm_type || null,
                };
              }
            } else {
              result.address = null;
            }
          } catch {
            result.address = null;
          }
        })(),
      );
    }

    // --- Weather ---
    if (requestedIncludes.includes("weather")) {
      promises.push(
        (async () => {
          const weatherData = await getWeather(lat, lon, forecastDays);
          if (weatherData) {
            if (units === "imperial") {
              const toF = (c: number) => Math.round(((c * 9) / 5 + 32) * 10) / 10;
              const toMph = (kmh: number) => Math.round(kmh * 0.621371 * 10) / 10;
              const toMi = (m: number) => Math.round(m * 0.000621371 * 10) / 10;
              const toIn = (mm: number) => Math.round(mm * 0.0393701 * 100) / 100;
              const toInHg = (hPa: number) => Math.round(hPa * 0.02953 * 100) / 100;

              weatherData.current.temperature = toF(weatherData.current.temperature);
              weatherData.current.apparentTemperature = toF(weatherData.current.apparentTemperature);
              weatherData.current.windSpeed = toMph(weatherData.current.windSpeed);
              weatherData.current.windGusts = toMph(weatherData.current.windGusts);
              weatherData.current.pressure = toInHg(weatherData.current.pressure);
              weatherData.current.precipitation = toIn(weatherData.current.precipitation);
              weatherData.current.visibility = toMi(weatherData.current.visibility);

              weatherData.daily.forEach((d) => {
                d.tempMax = toF(d.tempMax);
                d.tempMin = toF(d.tempMin);
                d.precipitationSum = toIn(d.precipitationSum);
                d.windSpeedMax = toMph(d.windSpeedMax);
              });

              weatherData.units = {
                temperature: "°F",
                windSpeed: "mph",
                pressure: "inHg",
                precipitation: "in",
                visibility: "mi",
              };
            }
            result.weather = weatherData;
          } else {
            result.weather = null;
          }
        })(),
      );
    }

    // --- Tides ---
    if (requestedIncludes.includes("tides")) {
      promises.push(
        (async () => {
          result.tides = await getTides(lat, lon);
        })(),
      );
    }

    // --- Waterways ---
    if (requestedIncludes.includes("waterways")) {
      promises.push(
        (async () => {
          const radius = 0.01;
          const query = `
            [out:json][timeout:10];
            (
              way["waterway"~"river|stream|canal"](${lat - radius},${lon - radius},${lat + radius},${lon + radius});
              way["natural"="water"](${lat - radius},${lon - radius},${lat + radius},${lon + radius});
            );
            out body;
          `;
          try {
            const res = await fetch("https://overpass-api.de/api/interpreter", {
              method: "POST",
              signal: AbortSignal.timeout(30000),
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `data=${encodeURIComponent(query)}`,
            });
            if (res.ok) {
              const data = (await res.json()) as { elements?: Record<string, unknown>[] };
              const elements = Array.isArray(data.elements) ? data.elements : [];
              result.waterways = {
                count: elements.length,
                features: elements.slice(0, 20).map((el: Record<string, unknown>) => {
                  const tags = el.tags as Record<string, string> | undefined;
                  return {
                    id: el.id,
                    name: tags?.name || null,
                    type: tags?.waterway || tags?.natural || null,
                  };
                }),
              };
            } else {
              result.waterways = null;
            }
          } catch {
            result.waterways = null;
          }
        })(),
      );
    }

    await Promise.all(promises);

    const hasWeather = requestedIncludes.includes("weather");
    const hasTides = requestedIncludes.includes("tides");
    const cacheMaxAge = hasWeather ? 300 : hasTides ? 1800 : 3600;

    return NextResponse.json(result, {
      headers: { ...CORS_HEADERS, "Cache-Control": `public, max-age=${cacheMaxAge}` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
