/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Data fetchers for globe layers.
 * All external API calls route through /api/proxy/ to avoid CORS issues.
 *
 * Includes in-flight request deduplication: if the same URL is already being
 * fetched, the existing promise is returned instead of creating a duplicate.
 */

/** In-flight request cache to prevent duplicate concurrent fetches */
const inflight = new Map<string, Promise<any>>();

/**
 * Deduplicated fetch with optional abort signal.
 * If a request for the same URL is already in-flight, returns that promise.
 */
function dedupFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = fetch(url, { signal }).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

export async function fetchEarthquakes(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch(
    "/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    signal,
  );
  return r.json();
}

export async function fetchRainViewer(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://api.rainviewer.com/public/weather-maps.json", signal);
  return r.json();
}

export async function fetchEONET(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch(
    "/api/proxy/https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200",
    signal,
  );
  return r.json();
}

export async function fetchFlights(
  bbox?: { lamin: number; lamax: number; lomin: number; lomax: number },
  signal?: AbortSignal,
): Promise<any> {
  const params = bbox ? `?lamin=${bbox.lamin}&lamax=${bbox.lamax}&lomin=${bbox.lomin}&lomax=${bbox.lomax}` : "";
  const r = await dedupFetch(`/api/opensky/flights${params}`, signal);
  return r.json();
}

export async function fetchFlightsAnonymous(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/flights", signal);
  return r.json();
}

export async function fetchMilitaryFlights(lat = 30, lon = -90, dist = 500, signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(`/api/military?lat=${lat}&lon=${lon}&dist=${dist}`, signal);
    return r.json();
  } catch {
    return { ac: [] };
  }
}

export async function fetchVessels(signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/vessels", signal);
    return r.json();
  } catch {
    return { error: "Failed to fetch vessel config" };
  }
}

export async function fetchWarnings(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/weather/warnings", signal);
  return r.json();
}

export async function fetchCelestrak(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json", signal);
  return r.json();
}

export async function fetchHurricaneTracks(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch(
    "/api/proxy/https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv",
    signal,
  );
  return r.text();
}

/* ── Tier 1 new data sources ─────────────────────────────── */

export async function fetchSWPCaurora(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://services.swpc.noaa.gov/json/ovation_aurora_latest.json", signal);
  return r.json();
}

export async function fetchSWPCkpForecast(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://services.swpc.noaa.gov/json/planetary-k-index-forecast.json", signal);
  return r.json();
}

export async function fetchAirQuality(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch(
    "/api/proxy/https://air-quality-api.open-meteo.com/v1/air-quality?latitude=0&longitude=0&current=us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,carbon_monoxide",
    signal,
  );
  return r.json();
}

export async function fetchSigmets(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://aviationweather.gov/api/data/sigmet?format=json", signal);
  return r.json();
}

export async function fetchAirmets(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://aviationweather.gov/api/data/airmet?format=json", signal);
  return r.json();
}

export async function fetchVolcanoAlerts(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://volcanoes.usgs.gov/feed/v0.1/all.geojson", signal);
  return r.json();
}

export async function fetchGDACS(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://www.gdacs.org/gdacsapi/api/events/geteventlist/ATOM", signal);
  return r.json();
}

export async function fetchMarineWeather(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch(
    "/api/proxy/https://marine-api.open-meteo.com/v1/marine?latitude=0&longitude=0&current=wave_height,wind_wave_height,wind_wave_direction,sea_surface_temperature",
    signal,
  );
  return r.json();
}

export async function fetchFIRMS(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/wildfires", signal);
  const data = await r.json();
  if (data.error) return "";
  // Convert GeoJSON back to CSV for globe layer compatibility
  const features = data.features || [];
  if (!features.length) return "";
  const lines = [
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight",
  ];
  for (const f of features) {
    const p = f.properties;
    lines.push(
      `0,0,${p.brightness || 0},1,1,2026-01-01,0,${p.satellite || "N"},VIIRS,${p.confidence || 0},1,300,${p.frp || 0},${p.daynight || "D"}`,
    );
    // Last two values before confidence are dummy scan/track, real lat/lon are set from geometry
    const coords = f.geometry.coordinates;
    const last = lines[lines.length - 1].split(",");
    last[0] = coords[1]; // lat
    last[1] = coords[0]; // lon
    lines[lines.length - 1] = last.join(",");
  }
  return lines.join("\n");
}
