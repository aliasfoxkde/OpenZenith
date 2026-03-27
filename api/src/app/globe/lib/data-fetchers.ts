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
  const r = await dedupFetch("/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", signal);
  return r.json();
}

export async function fetchRainViewer(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://api.rainviewer.com/public/weather-maps.json", signal);
  return r.json();
}

export async function fetchEONET(signal?: AbortSignal): Promise<any> {
  const r = await dedupFetch("/api/proxy/https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200", signal);
  return r.json();
}

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
