import { warnLayerError } from "@/lib/diagnostics";

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
  const timeout = setTimeout(() => { controller.abort(); }, timeoutMs);

  try {
    const p = fetch(url, { signal: controller.signal }).finally(() => {
      clearTimeout(timeout);
      inflight.delete(url);
    });
    inflight.set(url, p);
    return await p;
  } catch (err) {
    clearTimeout(timeout);
    inflight.delete(url);
    throw err;
  }
}

/** USGS earthquake event properties — the fields globe layers consume. */
export interface EarthquakeProperties {
  mag?: number;
  depth?: number;
  time?: number;
  place?: string;
  felt?: number;
  mmi?: number;
  alert?: string;
  tsunami?: number;
  sig?: number;
  type?: string;
  [key: string]: unknown;
}

/** USGS GeoJSON point feature (third coordinate is depth in km). */
export interface EarthquakeFeature {
  geometry?: { coordinates?: [number, number, number] };
  properties?: EarthquakeProperties;
}

/** USGS all_day GeoJSON feed — the subset globe layers consume. */
export interface EarthquakeCollection {
  type?: string;
  features?: EarthquakeFeature[];
}

/**
 * USGS earthquake summary feed (every event in the past day) fetched through
 * /api/proxy/ as `earthquake.usgs.gov/.../summary/all_day.geojson`. Resolves to
 * an `EarthquakeCollection`: GeoJSON point features whose third coordinate is
 * depth in km and whose properties carry `mag`, `time` (ms epoch), `place`,
 * `tsunami`, `sig`, and friends. Returns an empty FeatureCollection on failure
 * rather than throwing. The signal argument is unused.
 */
export async function fetchEarthquakes(_signal?: AbortSignal): Promise<EarthquakeCollection> {
  try {
    const r = await dedupFetch("/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
    const body: unknown = await r.json();
    return body as EarthquakeCollection;
  } catch (err) {
    warnLayerError("fetchEarthquakes", err);
    return { type: "FeatureCollection", features: [] };
  }
}

/**
 * RainViewer public weather-maps manifest (`api.rainviewer.com/public/weather-maps.json`)
 * through /api/proxy/. Resolves to the parsed JSON untyped (`any`) — globe
 * layers pick the radar frames and tile host out of it. Returns
 * `{ error: "RainViewer unavailable" }` on failure. The signal argument is
 * unused.
 */
export async function fetchRainViewer(_signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/proxy/https://api.rainviewer.com/public/weather-maps.json");
    return await r.json();
  } catch (err) {
    warnLayerError("fetchRainViewer", err);
    return { error: "RainViewer unavailable" };
  }
}

/**
 * NASA EONET v3 event feed through /api/proxy/ with a hard-coded
 * `status=open&limit=200` query, so no more than 200 open natural events come
 * back per call. Resolves to the parsed GeoJSON untyped (`any`). Returns an
 * empty FeatureCollection on failure. The signal argument is unused.
 */
export async function fetchEONET(_signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/proxy/https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200");
    return await r.json();
  } catch (err) {
    warnLayerError("fetchEONET", err);
    return { type: "FeatureCollection", features: [] };
  }
}

/** OpenSky REST state-vector row — positional fields, indexed via the SV map
 * in layers/flights.ts. Fields are string|number|boolean|null per the API. */
export type OpenSkyState = (string | number | boolean | null)[];

/** OpenSky REST response — the subset globe layers consume. */
export interface OpenSkyResponse {
  time?: number;
  states?: OpenSkyState[] | null;
  error?: string;
}

/**
 * Live aircraft state vectors via the internal `/api/opensky/flights` route,
 * which relays the OpenSky Network `/states/all` document (client-credential
 * authenticated server-side and credit-budgeted there). `bbox`, in decimal
 * degrees, becomes the `lamin/lamax/lomin/lomax` query; omitting it asks for
 * the global set. Resolves to `OpenSkyResponse`: `time` in UTC seconds plus
 * positional `states` rows indexed per the SV map in layers/flights.ts. Returns
 * `{ error: "Flights unavailable" }` on failure. The signal argument is unused.
 */
export async function fetchFlights(
  bbox?: { lamin: number; lamax: number; lomin: number; lomax: number },
  _signal?: AbortSignal,
): Promise<OpenSkyResponse> {
  try {
    const params = bbox ? `?lamin=${bbox.lamin}&lamax=${bbox.lamax}&lomin=${bbox.lomin}&lomax=${bbox.lomax}` : "";
    const r = await dedupFetch(`/api/opensky/flights${params}`);
    const body: unknown = await r.json();
    return body as OpenSkyResponse;
  } catch (err) {
    warnLayerError("fetchFlights", err);
    return { error: "Flights unavailable" };
  }
}

/**
 * Worldwide aircraft positions via the internal `/api/flights` route — there is
 * no bbox argument, this one always asks for the whole planet. Despite the
 * `OpenSkyResponse` type, `states` rows here are the route's slimmed named-key
 * objects (`icao24`, `callsign`, `latitude`, `longitude`, `baro_altitude`,
 * `velocity`, `true_track`, ...) rather than positional OpenSky arrays: the
 * route drops heavy fields to cut a ~6MB global payload to ~1MB. Returns
 * `{ error: "Flights unavailable" }` on failure. The signal argument is unused.
 */
export async function fetchFlightsAnonymous(_signal?: AbortSignal): Promise<OpenSkyResponse> {
  try {
    const r = await dedupFetch("/api/flights");
    const body: unknown = await r.json();
    return body as OpenSkyResponse;
  } catch (err) {
    warnLayerError("fetchFlightsAnonymous", err);
    return { error: "Flights unavailable" };
  }
}

/**
 * Military aircraft around a point via the internal `/api/military` route, which
 * proxies ADSB Exchange. `lat`/`lon` are decimal degrees (defaults 30/-90) and
 * `dist` is the search radius in nautical miles (default 500; the route clamps
 * it to 1000). Resolves to the parsed JSON whose `ac` array holds the aircraft,
 * alongside `count` and `total`; the route answers 200 with an `error` message
 * and an empty `ac` when the upstream subscription is absent. Returns
 * `{ ac: [] }` locally on failure. The signal argument is unused.
 */
export async function fetchMilitaryFlights(lat = 30, lon = -90, dist = 500, _signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(`/api/military?lat=${lat}&lon=${lon}&dist=${dist}`);
    return await r.json();
  } catch (err) {
    warnLayerError("fetchMilitaryFlights", err);
    return { ac: [] };
  }
}

/** AISstream.io connection config from /api/vessels — keyed or unconfigured. */
export interface VesselsConfig {
  wsUrl?: string | null;
  apiKey?: string | null;
  messageTypes?: string[];
  configured?: boolean;
  error?: string;
  message?: string;
}

/**
 * AISstream.io connection settings from the internal `/api/vessels` route: a
 * config document (`wsUrl`, `apiKey`, `messageTypes`, `configured`), not vessel
 * positions — the caller opens the WebSocket itself. `configured: false` with
 * null `wsUrl`/`apiKey` means AISSTREAM_KEY is unset server-side; a configured
 * response hands the live key to the browser. Returns
 * `{ error: "Vessels unavailable" }` on failure. The signal argument is unused.
 */
export async function fetchVessels(_signal?: AbortSignal): Promise<VesselsConfig> {
  try {
    const r = await dedupFetch("/api/vessels");
    const body: unknown = await r.json();
    return body as VesselsConfig;
  } catch (err) {
    warnLayerError("fetchVessels", err);
    return { error: "Vessels unavailable" };
  }
}

/**
 * Active severe-weather alerts via the internal `/api/weather/warnings` route,
 * which relays the NOAA/NWS `alerts/active` feed with verbose fields
 * (description, instruction, parameters) trimmed off. Resolves to a GeoJSON
 * FeatureCollection whose properties keep `event`, `severity`, `urgency`,
 * `areaDesc`, `effective`, `expires` and a few more, or `{ error }` from the
 * route when NWS itself fails. Returns `{ features: [] }` locally on failure.
 * The signal argument is unused.
 */
export async function fetchWarnings(_signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/weather/warnings");
    return await r.json();
  } catch (err) {
    warnLayerError("fetchWarnings", err);
    return { features: [] };
  }
}

/** CelesTrak GP (general perturbation) JSON record — the fields layers consume. */
export interface TleRecord {
  TLE_LINE1: string;
  TLE_LINE2: string;
  NAME?: string;
  OBJECT_NAME?: string;
  NORAD_CAT_ID?: string;
  /** CelesTrak sends many more GP fields; unconsumed ones stay open. */
  [key: string]: unknown;
}

/**
 * Element sets for every active satellite, from CelesTrak's GP service
 * (`gp.php?GROUP=active&FORMAT=json`) through /api/proxy/. Resolves to a
 * `TleRecord[]` several thousand entries long, each carrying `TLE_LINE1` and
 * `TLE_LINE2`; a proxy error page is an object rather than an array, so it is
 * collapsed to `[]` (the same value returned when the request fails). The signal
 * argument is unused.
 */
export async function fetchCelestrak(_signal?: AbortSignal): Promise<TleRecord[]> {
  try {
    const r = await dedupFetch("/api/proxy/https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json");
    const body: unknown = await r.json();
    // CelesTrak serves a JSON array; a proxy error page would be an object.
    return Array.isArray(body) ? (body as TleRecord[]) : [];
  } catch (err) {
    warnLayerError("fetchCelestrak", err);
    return [];
  }
}

/**
 * IBTrACS v04r01 best-track positions for the last three years, fetched
 * directly from ncei.noaa.gov without the /api/proxy/ hop the other fetchers
 * use. Resolves to the raw CSV text — a header row plus one row per storm fix —
 * left for the caller to parse. Returns "" on failure. The signal argument is
 * unused.
 */
export async function fetchHurricaneTracks(_signal?: AbortSignal): Promise<string> {
  try {
    const r = await dedupFetch(
      "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv",
    );
    return await r.text();
  } catch (err) {
    warnLayerError("fetchHurricaneTracks", err);
    return "";
  }
}

/**
 * NOAA SWPC OVATION aurora forecast (`ovation_aurora_latest.json`) through
 * /api/proxy/. Resolves to the parsed JSON untyped (`any`) for the globe layer
 * to map onto the poles. Returns `{ error: "Aurora data unavailable" }` on
 * failure. The signal argument is unused.
 */
export async function fetchSWPCaurora(_signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/proxy/https://services.swpc.noaa.gov/json/ovation_aurora_latest.json");
    return await r.json();
  } catch (err) {
    warnLayerError("fetchSWPCaurora", err);
    return { error: "Aurora data unavailable" };
  }
}

/**
 * NOAA SWPC planetary K-index forecast (`planetary-k-index-forecast.json`)
 * through /api/proxy/. Resolves to the parsed JSON untyped (`any`) — an array
 * of time-tagged forecast entries, which is why the fallback is an array.
 * Returns `[]` on failure. The signal argument is unused.
 */
export async function fetchSWPCkpForecast(_signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch("/api/proxy/https://services.swpc.noaa.gov/json/planetary-k-index-forecast.json");
    return await r.json();
  } catch (err) {
    warnLayerError("fetchSWPCkpForecast", err);
    return [];
  }
}

/**
 * Current air quality from Open-Meteo through /api/proxy/, pinned to the
 * hard-coded point latitude=0, longitude=0 (mid-Atlantic) rather than the
 * viewer's location. Fields requested: `us_aqi` (dimensionless index) plus
 * `pm10`, `pm2_5`, `nitrogen_dioxide`, `ozone`, `carbon_monoxide` in µg/m³.
 * Resolves to the parsed JSON untyped (`any`); returns
 * `{ error: "Air quality unavailable" }` on failure. The signal argument is
 * unused.
 */
export async function fetchAirQuality(_signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "/api/proxy/https://air-quality-api.open-meteo.com/v1/air-quality?latitude=0&longitude=0&current=us_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,carbon_monoxide",
    );
    return await r.json();
  } catch (err) {
    warnLayerError("fetchAirQuality", err);
    return { error: "Air quality unavailable" };
  }
}

/** aviationweather.gov serves a bare array for sigmet/airmet, but the shape
 * has varied historically — consumers normalize via unknown. */
export async function fetchSigmets(_signal?: AbortSignal): Promise<unknown> {
  try {
    const r = await dedupFetch("/api/proxy/https://aviationweather.gov/api/data/sigmet?format=json");
    return await r.json();
  } catch (err) {
    warnLayerError("fetchSigmets", err);
    return [];
  }
}

/**
 * Current AIRMETs from aviationweather.gov (`/api/data/airmet?format=json`)
 * through /api/proxy/. The payload shape has varied historically, so this stays
 * `unknown` and the caller normalizes it before use. Returns `[]` on failure.
 * The signal argument is unused.
 */
export async function fetchAirmets(_signal?: AbortSignal): Promise<unknown> {
  try {
    const r = await dedupFetch("/api/proxy/https://aviationweather.gov/api/data/airmet?format=json");
    return await r.json();
  } catch (err) {
    warnLayerError("fetchAirmets", err);
    return [];
  }
}

/** Volcano alert feature properties parsed from the SI/USGS weekly RSS feed. */
export interface VolcanoAlertProps {
  title?: string;
  name?: string;
  alertLevel?: string;
  alert_level?: string;
  url?: string;
  [key: string]: unknown;
}

/** Point feature for one alerted volcano. */
export interface VolcanoAlertFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: number[] } | null;
  properties: VolcanoAlertProps;
}

/** GeoJSON FeatureCollection of alerted volcanoes as scraped from the SI/USGS weekly RSS feed. */
export interface VolcanoAlertCollection {
  type: "FeatureCollection";
  features: VolcanoAlertFeature[];
}

/**
 * Volcanoes currently on alert, scraped client-side from the Smithsonian /
 * USGS WeeklyVolcanoRSS.xml at volcano.si.edu. This is the one layer fetcher
 * that goes direct (no /api/proxy/ hop, no dedupFetch) and the only one whose
 * `signal` is actually honored. Items are regex-parsed: an entry becomes a
 * feature only if it carries a `georss:point`, whose "lat lon" pair is flipped
 * to GeoJSON [lon, lat], and the alert level is inferred from the title text —
 * "Erupting" maps to WARNING, "New Unrest"/"New Activity" to WATCH, anything
 * else to ADVISORY (the feed's real alert field is not read). Resolves to a
 * `VolcanoAlertCollection`; features come back empty on failure.
 */
export async function fetchVolcanoAlerts(signal?: AbortSignal): Promise<VolcanoAlertCollection> {
  try {
    const r = await fetch("https://volcano.si.edu/news/WeeklyVolcanoRSS.xml", { signal });
    const text = await r.text();

    const features: VolcanoAlertFeature[] = [];
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
  } catch (err) {
    warnLayerError("fetchVolcanoAlerts", err);
    return { type: "FeatureCollection", features: [] };
  }
}

/**
 * Stub for the GDACS disaster feed: the public API was discontinued, so this
 * makes no network call and resolves to an empty FeatureCollection. It stays
 * promise-returning because every layer loader awaits its fetcher uniformly.
 * The signal argument is unused.
 */
export function fetchGDACS(_signal?: AbortSignal): Promise<any> {
  // GDACS public API discontinued — return empty.
  // Promise-shaped because layer loaders await their fetchers.
  return Promise.resolve({ type: "FeatureCollection", features: [] });
}

/**
 * Current marine conditions from Open-Meteo through /api/proxy/, pinned to the
 * hard-coded point latitude=0, longitude=0 (mid-Atlantic) rather than the
 * viewer's position. Fields requested: `wave_height` and `wind_wave_height` in
 * metres, `wind_wave_direction` in degrees, `sea_surface_temperature` in °C.
 * Resolves to the parsed JSON untyped (`any`); returns
 * `{ error: "Marine weather unavailable" }` on failure. The signal argument is
 * unused.
 */
export async function fetchMarineWeather(_signal?: AbortSignal): Promise<any> {
  try {
    const r = await dedupFetch(
      "/api/proxy/https://marine-api.open-meteo.com/v1/marine?latitude=0&longitude=0&current=wave_height,wind_wave_height,wind_wave_direction,sea_surface_temperature",
    );
    return await r.json();
  } catch (err) {
    warnLayerError("fetchMarineWeather", err);
    return { error: "Marine weather unavailable" };
  }
}

/**
 * Active fire detections via the internal `/api/wildfires` route (NASA FIRMS
 * VIIRS NRT, gated there by FIRMS_MAP_KEY and capped at 3000 features), then
 * re-serialized here into FIRMS CSV text so existing CSV parsers keep working.
 * The header is hard-coded and every row fills the columns the GeoJSON route
 * does not carry with placeholders — scan/track=1, acq_date=2026-01-01,
 * acq_time=0, version=1, bright_t31=300 — so only latitude, longitude,
 * brightness (Kelvin), confidence, frp, satellite and daynight are real.
 * Returns "" when the route reports an error or has no features. The signal
 * argument is unused.
 */
export async function fetchFIRMS(_signal?: AbortSignal): Promise<any> {
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
  } catch (err) {
    warnLayerError("fetchFIRMS", err);
    return "";
  }
}
