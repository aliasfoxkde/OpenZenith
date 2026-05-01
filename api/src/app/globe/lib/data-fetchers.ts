/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Data fetchers for globe layers.
 * All external API calls route through /api/proxy/ to avoid CORS issues.
 *
 * Features:
 * - In-flight request deduplication (prevents duplicate concurrent fetches)
 * - Timeout handling (AbortController, 15s default)
 * - Graceful degradation (returns empty data on failure, never throws)
 */

const DEFAULT_TIMEOUT = 15_000; // 15 seconds

/** In-flight request cache to prevent duplicate concurrent fetches */
const inflight = new Map<string, Promise<Response>>();

/**
 * Deduplicated fetch with timeout and optional abort signal.
 * If a request for the same URL is already in-flight, returns that promise.
 */
async function dedupFetch(url: string, timeoutMs = DEFAULT_TIMEOUT): Promise<Response> {
  const existing = inflight.get(url);
  if (existing) return existing;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const p = fetch(url, { signal: controller.signal }).finally(() => {
      clearTimeout(timeout);
      inflight.delete(url);
    }) as Promise<Response>;
    inflight.set(url, p);
    return await p;
  } catch (err) {
    clearTimeout(timeout);
    inflight.delete(url);
    throw err;
  }
}

export async function fetchEarthquakes(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    );
    return await r.json();
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

export async function fetchRainViewer(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/proxy/https://api.rainviewer.com/public/weather-maps.json");
    return await r.json();
  } catch {
    return { error: "RainViewer unavailable" };
  }
}

export async function fetchEONET(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "/api/proxy/https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200",
    );
    return await r.json();
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

export async function fetchFlights(
  bbox?: { lamin: number; lamax: number; lomin: number; lomax: number },
  signal?: AbortSignal,
): Promise<any> {
  try {
    const params = bbox ? `?lamin=${bbox.lamin}&lamax=${bbox.lamax}&lomin=${bbox.lomin}&lomax=${bbox.lomax}` : "";
    const r = await dedupFetch(`/api/opensky/flights${params}`);
    return await r.json();
  } catch {
    return { error: "Flights unavailable" };
  }
}

export async function fetchFlightsAnonymous(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/flights");
    return await r.json();
  } catch {
    return { error: "Flights unavailable" };
  }
}

export async function fetchMilitaryFlights(
  lat = 30,
  lon = -90,
  dist = 500,
  signal?: AbortSignal,
): Promise<any> {
  try {
    const r = await dedupFetch(`/api/military?lat=${lat}&lon=${lon}&dist=${dist}`);
    return await r.json();
  } catch {
    return { ac: [] };
  }
}

export async function fetchVessels(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/vessels");
    return await r.json();
  } catch {
    return { error: "Vessels unavailable" };
  }
}

export async function fetchWarnings(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/weather/warnings");
    return await r.json();
  } catch {
    return { features: [] };
  }
}

export async function fetchCelestrak(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "/api/proxy/https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json",
    );
    return await r.json();
  } catch {
    return [];
  }
}

export async function fetchHurricaneTracks(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv",
    );
    return await r.text();
  } catch {
    return "";
  }
}

export async function fetchSWPCaurora(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "/api/proxy/https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
    );
    return await r.json();
  } catch {
    return { error: "Aurora data unavailable" };
  }
}

export async function fetchSWPCkpForecast(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "/api/proxy/https://services.swpc.noaa.gov/json/planetary-k-index-forecast.json",
    );
    return await r.json();
  } catch {
    return [];
  }
}

export async function fetchAirQuality(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "/api/proxy/https://air-quality-api.open-meteo.com/v1/air-quality?latitude=0&longitude=0&current=us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,carbon_monoxide",
    );
    return await r.json();
  } catch {
    return { error: "Air quality unavailable" };
  }
}

export async function fetchSigmets(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/proxy/https://aviationweather.gov/api/data/sigmet?format=json");
    return await r.json();
  } catch {
    return [];
  }
}

export async function fetchAirmets(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/proxy/https://aviationweather.gov/api/data/airmet?format=json");
    return await r.json();
  } catch {
    return [];
  }
}

export async function fetchVolcanoAlerts(signal?: AbortSignal): Promise<any> {
  try {
    const r = await fetch("https://volcano.si.edu/news/WeeklyVolcanoRSS.xml", { signal });
    const text = await r.text();

    const features: GeoJSON.Feature[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(text)) !== null) {
      const entry = match[1];
      const title = entry.match(/<title>([^<]*)<\/title>/)?.[1] || "";
      const pointMatch = entry.match(/<georss:point>([^<]*)<\/georss:point>/);

      if (pointMatch) {
        const [latStr, lonStr] = pointMatch[1].trim().split(/\s+/);
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);

        if (!isNaN(lat) && !isNaN(lon)) {
          const isErupting = /Erupting/i.test(title);
          const isNew = /New Unrest|New Activity/i.test(title);
          const alert = isErupting ? "WARNING" : isNew ? "WATCH" : "ADVISORY";

          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lon, lat] },
            properties: { title, alertLevel: alert },
          });
        }
      }
    }

    return { type: "FeatureCollection", features };
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

export async function fetchGDACS(signal?: AbortSignal): Promise<any> {
  // GDACS public API discontinued — return empty
  return { type: "FeatureCollection", features: [] };
}

export async function fetchMarineWeather(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "/api/proxy/https://marine-api.open-meteo.com/v1/marine?latitude=0&longitude=0&current=wave_height,wind_wave_height,wind_wave_direction,sea_surface_temperature",
    );
    return await r.json();
  } catch {
    return { error: "Marine weather unavailable" };
  }
}

export async function fetchFIRMS(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/wildfires");
    const data = await r.json();
    if (data.error) return "";
    const features = data.features || [];
    if (!features.length) return "";

    const lines = [
      "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight",
    ];
    for (const f of features) {
      const p = f.properties;
      const coords = f.geometry.coordinates;
      lines.push(
        `${coords[1]},${coords[0]},${p.brightness || 0},1,1,2026-01-01,0,${p.satellite || "N"},VIIRS,${p.confidence || 0},1,300,${p.frp || 0},${p.daynight || "D"}`,
      );
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}
