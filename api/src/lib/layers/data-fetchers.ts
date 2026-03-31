/**
 * Shared data fetchers for all views (Map, Globe, Studio).
 *
 * Provides a unified interface for fetching layer data with caching
 * and deduplication. All views should import from here instead of
 * implementing their own fetch logic.
 */

/** In-flight request deduplication */
const inflight = new Map<string, Promise<any>>();

function dedupFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = fetch(url, { signal }).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

// ─── Earthquakes ───

export async function fetchEarthquakes(signal?: AbortSignal): Promise<GeoJSON.FeatureCollection> {
  const r = await dedupFetch("/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", signal);
  if (!r.ok) throw new Error(`Earthquakes fetch failed: ${r.status}`);
  return r.json();
}

// ─── Natural Events (EONET) ───

export async function fetchNaturalEvents(signal?: AbortSignal): Promise<GeoJSON.FeatureCollection> {
  const r = await dedupFetch("/api/proxy/https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200", signal);
  if (!r.ok) throw new Error(`EONET fetch failed: ${r.status}`);
  return r.json();
}

// ─── Weather Warnings ───

export async function fetchWeatherWarnings(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/weather/warnings", signal);
  if (!r.ok) throw new Error(`Warnings fetch failed: ${r.status}`);
  return r.json();
}

// ─── RainViewer Radar ───

export async function fetchRainViewer(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://api.rainviewer.com/public/weather-maps.json", signal);
  if (!r.ok) throw new Error(`RainViewer fetch failed: ${r.status}`);
  return r.json();
}

// ─── NLNOG Nodes ───

export async function fetchNLNOG(signal?: AbortSignal): Promise<{ nodes: any[]; count: number }> {
  const r = await dedupFetch("/api/nlnog", signal);
  if (!r.ok) throw new Error(`NLNOG fetch failed: ${r.status}`);
  return r.json();
}

// ─── Wildfires (NASA FIRMS) ───

export async function fetchWildfires(signal?: AbortSignal): Promise<GeoJSON.FeatureCollection> {
  const r = await dedupFetch("/api/wildfires", signal);
  if (!r.ok) throw new Error(`FIRMS fetch failed: ${r.status}`);
  return r.json();
}

// ─── Waterways ───

export async function fetchWaterways(lon: number, lat: number, signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch(`/api/waterways?lon=${lon}&lat=${lat}`, signal);
  if (!r.ok) throw new Error(`Waterways fetch failed: ${r.status}`);
  return r.json();
}

// ─── Flights ───

export async function fetchFlights(bbox?: { lamin: number; lamax: number; lomin: number; lomax: number }, signal?: AbortSignal): Promise<any> {
  const params = bbox
    ? `?lamin=${bbox.lamin}&lamax=${bbox.lamax}&lomin=${bbox.lomin}&lomax=${bbox.lomax}`
    : "";
  const r = await dedupFetch(`/api/opensky/flights${params}`, signal);
  return r.json();
}

export async function fetchFlightsAnonymous(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/flights", signal);
  return r.json();
}

// ─── Vessels ───

export async function fetchVessels(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/vessels", signal);
  return r.json();
}

// ─── Military ───

export async function fetchMilitary(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/military", signal);
  return r.json();
}
