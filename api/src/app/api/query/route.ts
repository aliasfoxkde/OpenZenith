import { NextRequest, NextResponse } from "next/server";
import { getElevation } from "@/lib/elevation";
import { getDefaultBackend } from "@/lib/storage/backend";
import { getCopernicusElevation } from "@/lib/copernicus/cog-reader";
import { getGebcoElevation } from "@/lib/gebco/cog-reader";
import { isWithinSRTM } from "@/lib/srtm/tile-math";
import { getWeather } from "@/lib/weather/open-meteo";
import { getTides } from "@/lib/tides/noaa";

export const runtime = "edge";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const VALID_INCLUDES = ["elevation", "address", "weather", "tides", "waterways"] as const;
type IncludeType = (typeof VALID_INCLUDES)[number];

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
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
 *   dataset      - Elevation dataset (auto|srtm30m|copernicus-glo30|gebco2025)
 *   units        - Temperature units: "metric" (default) or "imperial"
 *   forecast_days - Weather forecast days (1-7, default: 3)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");
  const includeStr = searchParams.get("include") || "elevation";
  const dataset = searchParams.get("dataset") || "auto";
  const units = searchParams.get("units") || "metric";
  const forecastDays = Math.min(Math.max(Number(searchParams.get("forecast_days")) || 3, 1), 7);

  // Validate coordinates
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

  // Parse includes
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

  // Validate elevation dataset
  const validDatasets = ["auto", "srtm30m", "copernicus-glo30", "gebco2025"];
  if (!validDatasets.includes(dataset)) {
    return NextResponse.json(
      { error: `Invalid dataset. Must be one of: ${validDatasets.join(", ")}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const result: Record<string, unknown> = {
      location: { lat, lon },
      query: {
        includes: requestedIncludes,
        dataset: requestedIncludes.includes("elevation") ? dataset : undefined,
        units,
        timestamp: new Date().toISOString(),
      },
    };

    // Fetch all requested data sources in parallel
    const promises: Array<Promise<void>> = [];

    // --- Elevation ---
    if (requestedIncludes.includes("elevation")) {
      promises.push(
        (async () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let elevResult: any;

          if (dataset === "gebco2025") {
            elevResult = await getGebcoElevation(lat, lon);
          } else if (dataset === "copernicus-glo30") {
            elevResult = await getCopernicusElevation(lat, lon);
          } else if (dataset === "srtm30m") {
            const storage = getDefaultBackend();
            elevResult = await getElevation(lat, lon, storage);
          } else {
            // Auto cascade
            if (isWithinSRTM(lat, lon)) {
              const storage = getDefaultBackend();
              const srtmResult = await getElevation(lat, lon, storage);
              if (srtmResult.elevation !== null) {
                elevResult = srtmResult;
              } else {
                elevResult = await getCopernicusElevation(lat, lon);
                if (elevResult.elevation === null) {
                  elevResult = await getGebcoElevation(lat, lon);
                }
              }
            } else {
              elevResult = await getCopernicusElevation(lat, lon);
              if (elevResult.elevation === null) {
                elevResult = await getGebcoElevation(lat, lon);
              }
            }
          }

          result.elevation = elevResult;
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
              headers: { "User-Agent": "OpenZenith/1.0 (geospatial platform)" },
            });

            if (res.ok) {
              const data = await res.json();
              if (data.error) {
                result.address = null;
              } else {
                result.address = {
                  display_name: data.display_name || null,
                  name: data.name || data.display_name?.split(",")[0] || null,
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
            // Convert units if imperial requested
            if (units === "imperial") {
              const toF = (c: number) => Math.round((c * 9 / 5 + 32) * 10) / 10;
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
          const tideData = await getTides(lat, lon);
          result.tides = tideData;
        })(),
      );
    }

    // --- Waterways ---
    if (requestedIncludes.includes("waterways")) {
      promises.push(
        (async () => {
          const radius = 0.01; // ~1km
          const bbox = `${lon - radius},${lat - radius},${lon + radius},${lat + radius}`;
          const query = `
            [out:json][timeout:10];
            (
              way["waterway"~"river|stream|canal"](${lat - radius},${lon - radius},${lat + radius},${lon + radius});
              way["natural"="water"](${lat - radius},${lon - radius},${lat + radius},${lon + radius});
            );
            out body;
          `;

          try {
            const overpassUrl = "https://overpass-api.de/api/interpreter";
            const res = await fetch(overpassUrl, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: `data=${encodeURIComponent(query)}`,
            });

            if (res.ok) {
              const data = await res.json();
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

    // Execute all fetches in parallel
    await Promise.all(promises);

    // Set cache control based on which data was requested
    const hasWeather = requestedIncludes.includes("weather");
    const hasTides = requestedIncludes.includes("tides");
    const cacheMaxAge = hasWeather ? 300 : hasTides ? 1800 : 3600;

    return NextResponse.json(result, {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": `public, max-age=${cacheMaxAge}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
