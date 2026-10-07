import { warnLayerError } from "@/lib/diagnostics";

/**
 * Data fetchers for globe layers.
 * All external API calls route through /api/proxy/ to avoid CORS issues.
 *
 * Features:
 * - In-flight request deduplication (prevents duplicate concurrent fetches)
 * - Timeout handling (AbortController, 15s default)
 * - Graceful degradation on transport failures (network / timeout / abort →
 *   empty data, never a rejection)
 * - Honest HTTP failures: a non-2xx status throws instead of being parsed, so
 *   the layer's catch branch can surface it — the backend answers upstream
 *   failures with 502 + a JSON `{error}` body, and casting that into a success
 *   shape rendered layers silent-empty
 */

const DEFAULT_TIMEOUT = 15_000; // 15 seconds

/** In-flight request cache to prevent duplicate concurrent fetches */
const inflight = new Map<string, Promise<Response>>();

/**
 * Deduplicated fetch with timeout and optional abort signal.
 * If a request for the same URL is already in-flight, returns that promise.
 */
async function dedupFetch(url: string, timeoutMs = DEFAULT_TIMEOUT, signal?: AbortSignal): Promise<Response> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const existing = inflight.get(url);
  // A dedup hit shares another caller's request: an external abort only
  // abandons THIS await — it must not kill the shared request other callers
  // are still awaiting.
  if (existing) return abortable(existing, signal);

  const controller = new AbortController();
  const onExternalAbort = () => { controller.abort(); };
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeout = setTimeout(() => { controller.abort(); }, timeoutMs);

  try {
    const p = fetch(url, { signal: controller.signal }).finally(() => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onExternalAbort);
      inflight.delete(url);
    });
    inflight.set(url, p);
    return await abortable(p, signal);
  } catch (err) {
    clearTimeout(timeout);
    inflight.delete(url);
    throw err;
  }
}

/** Reject early when `signal` aborts, without disturbing `p` for others. */
function abortable(p: Promise<Response>, signal?: AbortSignal): Promise<Response> {
  if (!signal) return p;
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => {
      // DOMException(AbortError) is the platform's abort rejection type — the
      // same thing signal.throwIfAborted() throws.
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      // Normalize to Error: everything upstream throws Error subclasses
      // (TypeError from fetch, DOMException on abort), but reject(unknown)
      // would leave callers a non-Error rejection if that ever changes.
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** True when `err` is an expected abort (teardown), not a real failure. */
export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Body shared by the JSON layer fetchers: deduplicated fetch plus parse, with
 * the two failure modes split. A transport failure (network error, timeout,
 * abort) logs and resolves to `fallback`, so a layer keeps whatever it had. An
 * HTTP error status throws — every layer awaits its fetcher inside a try/catch
 * that feeds `updateStatus({ error })`, so the throw lands there instead of an
 * error body being type-cast into a success shape.
 */
async function fetchJsonOrFallback<T>(label: string, url: string, fallback: T, signal?: AbortSignal): Promise<T> {
  let r: Response;
  let body: unknown;
  try {
    r = await dedupFetch(url, DEFAULT_TIMEOUT, signal);
    body = await r.json();
  } catch (err) {
    if (!isAbort(err)) warnLayerError(label, err);
    return fallback;
  }
  // Checked outside the catch above so the throw reaches the layer.
  if (!r.ok) throw new Error(`${label} unavailable (HTTP ${r.status})`);
  return body as T;
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
 * `tsunami`, `sig`, and friends. A transport failure resolves to an empty
 * FeatureCollection; an HTTP error status throws so the layer's error status
 * engages. Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchEarthquakes(signal?: AbortSignal): Promise<EarthquakeCollection> {
  return fetchJsonOrFallback<EarthquakeCollection>(
    "fetchEarthquakes",
    "/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    { type: "FeatureCollection", features: [] },
    signal,
  );
}

/** One RainViewer radar frame — `path` is the tile-cache timestamp prefix. */
export interface RainViewerFrame {
  time?: number;
  path?: string;
  [key: string]: unknown;
}

/** RainViewer weather-maps manifest — the fields the radar layer consumes. */
export interface RainViewerResponse {
  host?: string;
  radar?: {
    past?: RainViewerFrame[];
    forecast?: RainViewerFrame[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * RainViewer public weather-maps manifest (`api.rainviewer.com/public/weather-maps.json`)
 * through /api/proxy/. Resolves to a `RainViewerResponse` — globe layers pick
 * the radar frames and tile host out of it. A transport failure resolves to
 * `{ error: "RainViewer unavailable" }`; an HTTP error status throws. Aborting `signal` abandons the caller's wait; layers pass their toggle
 * controller so a torn-down layer stops waiting on the network.
 */
export async function fetchRainViewer(signal?: AbortSignal): Promise<RainViewerResponse> {
  return fetchJsonOrFallback<RainViewerResponse>(
    "fetchRainViewer",
    "/api/proxy/https://api.rainviewer.com/public/weather-maps.json",
    { error: "RainViewer unavailable" },
    signal,
  );
}

/** NASA EONET v3 GeoJSON event feature — the fields the events layer consumes. */
export interface EonetFeature {
  id?: string;
  geometry?: { coordinates?: [number, number] };
  properties?: {
    title?: string;
    description?: string;
    updated?: number;
    geometry_lastModified?: number;
    categories?: { id?: string }[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** NASA EONET v3 GeoJSON feed — `features` is the only field layers read. */
export interface EonetCollection {
  type?: string;
  features?: EonetFeature[];
  [key: string]: unknown;
}

/**
 * NASA EONET v3 event feed through /api/proxy/ with a hard-coded
 * `status=open&limit=200` query, so no more than 200 open natural events come
 * back per call. Resolves to an `EonetCollection`. A transport failure resolves
 * to an empty FeatureCollection; an HTTP error status throws. Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchEONET(signal?: AbortSignal): Promise<EonetCollection> {
  return fetchJsonOrFallback<EonetCollection>(
    "fetchEONET",
    "/api/proxy/https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200",
    { type: "FeatureCollection", features: [] },
    signal,
  );
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
 * `{ error: "Flights unavailable" }` on failure. Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchFlights(
  bbox?: { lamin: number; lamax: number; lomin: number; lomax: number },
  signal?: AbortSignal,
): Promise<OpenSkyResponse> {
  try {
    const params = bbox ? `?lamin=${bbox.lamin}&lamax=${bbox.lamax}&lomin=${bbox.lomin}&lomax=${bbox.lomax}` : "";
    const r = await dedupFetch(`/api/opensky/flights${params}`, DEFAULT_TIMEOUT, signal);
    const body: unknown = await r.json();
    return body as OpenSkyResponse;
  } catch (err) {
    if (!isAbort(err)) warnLayerError("fetchFlights", err);
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
 * `{ error: "Flights unavailable" }` on failure. Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchFlightsAnonymous(signal?: AbortSignal): Promise<OpenSkyResponse> {
  try {
    const r = await dedupFetch("/api/flights", DEFAULT_TIMEOUT, signal);
    const body: unknown = await r.json();
    return body as OpenSkyResponse;
  } catch (err) {
    if (!isAbort(err)) warnLayerError("fetchFlightsAnonymous", err);
    return { error: "Flights unavailable" };
  }
}

/** ADS-B Exchange aircraft row relayed by /api/military — fields the layer reads. */
export interface MilitaryAircraftRecord {
  lat?: number;
  lon?: number;
  alt_baro?: number;
  alt_geom?: number;
  call?: string;
  reg?: string;
  [key: string]: unknown;
}

/** /api/military response — `ac` holds the aircraft, `msg` the failure text. */
export interface MilitaryFlightsResponse {
  ac?: MilitaryAircraftRecord[];
  count?: number;
  total?: number;
  msg?: string;
  [key: string]: unknown;
}

/**
 * Military aircraft around a point via the internal `/api/military` route, which
 * proxies ADSB Exchange. `lat`/`lon` are decimal degrees (defaults 30/-90) and
 * `dist` is the search radius in nautical miles (default 500; the route clamps
 * it to 1000). Resolves to a `MilitaryFlightsResponse` whose `ac` array holds
 * the aircraft, alongside `count` and `total`; the route answers 200 with an
 * `error` message and an empty `ac` when the upstream subscription is absent.
 * A transport failure resolves to `{ ac: [] }`; an HTTP error status throws.
 * Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchMilitaryFlights(
  lat = 30,
  lon = -90,
  dist = 500,
  signal?: AbortSignal,
): Promise<MilitaryFlightsResponse> {
  return fetchJsonOrFallback<MilitaryFlightsResponse>(
    "fetchMilitaryFlights",
    `/api/military?lat=${lat}&lon=${lon}&dist=${dist}`,
    { ac: [] },
    signal,
  );
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
 * response hands the live key to the browser. A transport failure resolves to
 * `{ error: "Vessels unavailable" }`; an HTTP error status throws. Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchVessels(signal?: AbortSignal): Promise<VesselsConfig> {
  return fetchJsonOrFallback<VesselsConfig>(
    "fetchVessels",
    "/api/vessels",
    { error: "Vessels unavailable" },
    signal,
  );
}

/** NWS alert feature properties — the fields the warnings layer consumes. */
export interface WarningProperties {
  event?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  areaDesc?: string;
  headline?: string;
  effective?: string;
  expires?: string;
  [key: string]: unknown;
}

/** One NWS alert GeoJSON feature. */
export interface WarningFeature {
  type?: string;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: WarningProperties;
  [key: string]: unknown;
}

/** /api/weather/warnings response — GeoJSON FeatureCollection, or `error`. */
export interface WarningsResponse {
  type?: string;
  features?: WarningFeature[];
  error?: string;
  [key: string]: unknown;
}

/**
 * Active severe-weather alerts via the internal `/api/weather/warnings` route,
 * which relays the NOAA/NWS `alerts/active` feed with verbose fields
 * (description, instruction, parameters) trimmed off. Resolves to a
 * `WarningsResponse` — a GeoJSON FeatureCollection whose properties keep
 * `event`, `severity`, `urgency`, `areaDesc`, `effective`, `expires` and a few
 * more, or `{ error }` from the route when NWS itself fails. A transport
 * failure resolves to `{ features: [] }`; an HTTP error status throws.
 * Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchWarnings(signal?: AbortSignal): Promise<WarningsResponse> {
  return fetchJsonOrFallback<WarningsResponse>(
    "fetchWarnings",
    "/api/weather/warnings",
    { features: [] },
    signal,
  );
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
 * collapsed to `[]`. A transport failure also resolves to `[]`; an HTTP error
 * status throws. The signal argument is unused.
 */
export async function fetchCelestrak(signal?: AbortSignal): Promise<TleRecord[]> {
  // CelesTrak serves a JSON array; a proxy error page would be an object.
  const body = await fetchJsonOrFallback<unknown>(
    "fetchCelestrak",
    "/api/proxy/https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json",
    [],
    signal,
  );
  return Array.isArray(body) ? (body as TleRecord[]) : [];
}

/**
 * IBTrACS v04r01 best-track positions for the last three years, fetched
 * directly from ncei.noaa.gov without the /api/proxy/ hop the other fetchers
 * use. Resolves to the raw CSV text — a header row plus one row per storm fix —
 * left for the caller to parse. A transport failure resolves to ""; an HTTP
 * error status throws. Aborting `signal` abandons the caller's wait; layers pass their toggle
 * controller so a torn-down layer stops waiting on the network.
 */
export async function fetchHurricaneTracks(signal?: AbortSignal): Promise<string> {
  let r: Response;
  try {
    r = await dedupFetch("https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv", DEFAULT_TIMEOUT, signal);
  } catch (err) {
    if (!isAbort(err)) warnLayerError("fetchHurricaneTracks", err);
    return "";
  }
  // Outside the catch so the throw reaches the layer's error branch.
  if (!r.ok) throw new Error(`fetchHurricaneTracks unavailable (HTTP ${r.status})`);
  return r.text();
}

/**
 * NOAA SWPC OVATION aurora forecast — `coordinates` holds `[lon, lat,
 * intensity]` triples the globe layer maps onto the poles.
 */
export interface AuroraForecast {
  coordinates?: number[][];
  observation_time?: string;
  forecast_time?: string;
  [key: string]: unknown;
}

/**
 * One NOAA SWPC planetary K-index forecast entry.
 */
export interface KpForecastEntry {
  time_tag?: string;
  kp_index?: number;
  estimated_kp?: number;
  kp?: number;
  [key: string]: unknown;
}

/**
 * NOAA SWPC OVATION aurora forecast (`ovation_aurora_latest.json`) through
 * /api/proxy/. Resolves to an `AuroraForecast` for the globe layer
 * to map onto the poles, nullable because `Response.json()` may resolve null
 * and the consumer guards on nullish. Resolves to
 * `{ error: "Aurora data unavailable" }` on failure rather than throwing — the
 * only caller (layers/space-weather.ts) catches this fetch and treats aurora
 * polygons as optional, so a throw has nowhere to land. Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchSWPCaurora(signal?: AbortSignal): Promise<AuroraForecast | null> {
  try {
    const r = await dedupFetch("/api/proxy/https://services.swpc.noaa.gov/json/ovation_aurora_latest.json", DEFAULT_TIMEOUT, signal);
    // Same reason as above: the caller swallows, so report in-band.
    if (!r.ok) return { error: "Aurora data unavailable" };
    const body: unknown = await r.json();
    return body as AuroraForecast | null;
  } catch (err) {
    if (!isAbort(err)) warnLayerError("fetchSWPCaurora", err);
    return { error: "Aurora data unavailable" };
  }
}

/**
 * NOAA SWPC planetary K-index forecast (`planetary-k-index-forecast.json`)
 * through /api/proxy/. Resolves to the parsed `KpForecastEntry[]` — an array
 * of time-tagged forecast entries, which is why the fallback is an array
 * (nullable for the same `Response.json()` reason as `fetchSWPCaurora`).
 * A transport failure resolves to `[]`; an HTTP error status throws. Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchSWPCkpForecast(signal?: AbortSignal): Promise<KpForecastEntry[] | null> {
  return fetchJsonOrFallback<KpForecastEntry[] | null>(
    "fetchSWPCkpForecast",
    "/api/proxy/https://services.swpc.noaa.gov/json/planetary-k-index-forecast.json",
    [],
    signal,
  );
}

/** Open-Meteo air-quality `current` block — the fields the request asks for. */
export interface AirQualityCurrent {
  time?: string;
  us_aqi?: number;
  pm10?: number;
  pm2_5?: number;
  nitrogen_dioxide?: number;
  ozone?: number;
  carbon_monoxide?: number;
  [key: string]: unknown;
}

/** Open-Meteo air-quality response for the pinned mid-Atlantic point. */
export interface AirQualityResponse {
  latitude?: number;
  longitude?: number;
  current?: AirQualityCurrent;
  [key: string]: unknown;
}

/** aviationweather.gov serves a bare array for sigmet/airmet, but the shape
 * has varied historically — consumers normalize via unknown. */
export async function fetchSigmets(signal?: AbortSignal): Promise<unknown> {
  return fetchJsonOrFallback<unknown>(
    "fetchSigmets",
    "/api/proxy/https://aviationweather.gov/api/data/sigmet?format=json",
    [],
    signal,
  );
}

/**
 * Current AIRMETs from aviationweather.gov (`/api/data/airmet?format=json`)
 * through /api/proxy/. The payload shape has varied historically, so this stays
 * `unknown` and the caller normalizes it before use. A transport failure
 * resolves to `[]`; an HTTP error status throws.
 * Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export async function fetchAirmets(signal?: AbortSignal): Promise<unknown> {
  return fetchJsonOrFallback<unknown>(
    "fetchAirmets",
    "/api/proxy/https://aviationweather.gov/api/data/airmet?format=json",
    [],
    signal,
  );
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

/** GeoJSON FeatureCollection of alerted volcanoes from the /api/volcanoes proxy. */
export interface VolcanoAlertCollection {
  type: "FeatureCollection";
  features: VolcanoAlertFeature[];
}

/**
 * Volcanoes currently on alert, from the same-origin /api/volcanoes proxy
 * (USGS HANS alert statuses as GeoJSON). The feed this used to scrape
 * client-side — Smithsonian WeeklyVolcanoRSS.xml — is CORS-blocked to
 * browsers AND bot-gated against server fetches, so the proxy is the only
 * viable path; it was previously the one layer fetcher that went direct.
 * Resolves to a `VolcanoAlertCollection`; features come back empty on
 * failure.
 */
export async function fetchVolcanoAlerts(signal?: AbortSignal): Promise<VolcanoAlertCollection> {
  try {
    const r = await fetch("/api/volcanoes", { signal });
    const data = (await r.json()) as VolcanoAlertCollection | null;
    if (!r.ok || data?.type !== "FeatureCollection") {
      return { type: "FeatureCollection", features: [] };
    }
    return data;
  } catch (err) {
    if (!isAbort(err)) warnLayerError("fetchVolcanoAlerts", err);
    return { type: "FeatureCollection", features: [] };
  }
}

/**
 * GDACS response probe fields. The public API is discontinued, so the stub
 * below resolves an empty FeatureCollection and these stay open for the
 * consumer's parser, which reads all three payload shapes. Nullable for the
 * same `Response.json()` reason as `fetchSWPCaurora`.
 */
export interface GdacsResponse {
  atom?: { entry?: unknown };
  entries?: unknown;
  events?: unknown;
  [key: string]: unknown;
}

/**
 * Disabled fetcher for the GDACS disaster feed: the public API was
 * discontinued, so this makes no network call and resolves to an empty
 * FeatureCollection. It stays
 * promise-returning because every layer loader awaits its fetcher uniformly.
 * Aborting `signal` abandons the caller's wait; layers pass their toggle controller so a torn-down layer stops waiting on the network.
 */
export function fetchGDACS(
  // Nothing to abort: the GDACS public API is discontinued and this resolves
  // empty without touching the network; the param survives so layer loaders
  // can pass their signal uniformly.
  _signal?: AbortSignal,
): Promise<GdacsResponse | null> {
  // GDACS public API discontinued — return empty.
  // Promise-shaped because layer loaders await their fetchers.
  return Promise.resolve({ type: "FeatureCollection", features: [] });
}

/** Open-Meteo marine `current` block — the fields the request asks for. */
export interface MarineWeatherCurrent {
  time?: string;
  wave_height?: number;
  wind_wave_height?: number;
  wind_wave_direction?: number;
  sea_surface_temperature?: number;
  [key: string]: unknown;
}

/** Open-Meteo marine response for the pinned mid-Atlantic point. */
export interface MarineWeatherResponse {
  latitude?: number;
  longitude?: number;
  current?: MarineWeatherCurrent;
  [key: string]: unknown;
}

/**
 * /api/wildfires GeoJSON feature. `properties` and `geometry` are declared
 * required because the CSV loop below dereferences them unguarded — a missing
 * field throws into the catch, exactly as it did when this was untyped.
 */
interface WildfireFeature {
  properties: {
    brightness?: number;
    satellite?: string;
    confidence?: number;
    frp?: number;
    daynight?: string;
    [key: string]: unknown;
  };
  geometry: { coordinates: number[] };
  [key: string]: unknown;
}

/** /api/wildfires response — GeoJSON FeatureCollection, or `{ error }`. */
interface WildfiresPayload {
  error?: unknown;
  features?: WildfireFeature[];
  [key: string]: unknown;
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
export async function fetchFIRMS(signal?: AbortSignal): Promise<string> {
  try {
    const r = await dedupFetch("/api/wildfires", DEFAULT_TIMEOUT, signal);
    const data = (await r.json()) as WildfiresPayload;
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
    if (!isAbort(err)) warnLayerError("fetchFIRMS", err);
    return "";
  }
}
