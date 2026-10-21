/**
 * Data Explorer shared data: API response types, tab/dataset catalogs, and
 * fetch/format helpers. Moved verbatim from explore/page.tsx so the tab
 * components (explore/tabs/) and the page share one definition.
 */

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

/**
 * One element of an Overpass API response - a node, way or relation.
 * `type` and `id` identify it; `lat`/`lon` are set for nodes while `center`
 * carries the representative point for ways and relations; `tags` holds the
 * OSM attributes; `geometry` the ordered way vertices; `nodes` the member
 * node ids of a way; `bounds` the extent; and `members` the member list of
 * a relation.
 */
export interface OverpassElement {
  type: string;
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  center?: { lat: number; lon: number };
  members?: unknown[];
  [key: string]: unknown;
}

/**
 * Envelope of an Overpass API response: the matched `elements` plus the
 * server's OSM base timestamp under `osm3s.timestamp_osm_base`.
 */
export interface OverpassResult {
  elements: OverpassElement[];
  osm3s?: { timestamp_osm_base: string };
}

/**
 * Attribute bag of a GeoJSON feature as returned by the USGS, ArcGIS and
 * NASA EONET feeds the Explorer proxies. Every field is optional because
 * each upstream uses a different subset; the Explorer reads the magnitude
 * (`mag`/`magnitude`), the place (`place`), the event time (`time`), the
 * depth, and the `event`/`eventType`/`type` labels.
 */
export interface GeoFeatureProperties {
  mag?: number;
  magnitude?: number;
  place?: string;
  title?: string;
  name?: string;
  event?: string;
  time?: number;
  depth?: number | string;
  type?: string;
  eventType?: string;
  tsunami?: boolean;
  cd?: number;
  coordinates?: number[];
  severity?: string;
  areaDesc?: string;
  headline?: string;
  [key: string]: unknown;
}

interface GeoFeatureGeometry {
  type?: string;
  coordinates?: number[] | number[][][] | number[][][][];
}

/**
 * A GeoJSON feature from one of the proxied USGS/NWS/EONET feeds, carrying
 * its attributes in `properties` and an optional `geometry` - a GeoJSON
 * geometry object whose `coordinates` are lon/lat pairs.
 */
export interface GeoFeature {
  properties: GeoFeatureProperties;
  geometry?: GeoFeatureGeometry;
}

/**
 * One period of an api.weather.gov forecast response: the `isDaytime` flag,
 * the `temperature` in the unit named by `temperatureUnit`, the period
 * `name` and `shortForecast` text, the `windSpeed` and `windDirection`,
 * and the period's `startTime`.
 */
export interface NoaaForecastPeriod {
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  name?: string;
  shortForecast?: string;
  windSpeed?: string;
  windDirection?: string;
  startTime?: string;
}

/**
 * Attributes of an active NWS weather alert: its `severity`, the `event`
 * type, the `title`, the `areaDesc` naming the affected area, and the
 * `headline` summary.
 */
export interface NwsAlertProperties {
  severity?: string;
  event?: string;
  title?: string;
  areaDesc?: string;
  headline?: string;
}

/**
 * A NASA EONET natural-event record: the event `title`, its `categories`
 * (each with a label, colour and id), the `sources` that reported it, and
 * the `geometry` - a GeoJSON geometry such as a Polygon or Point - that
 * locates it.
 */
export interface EonetEvent {
  title?: string;
  categories?: { title?: string; color?: string; id?: string }[];
  sources?: { id?: string; url?: string }[];
  geometry?: {
    type?: string;
    coordinates?: number[][][][] | number[][];
  };
}

/**
 * One NORAD/GP element record from Celestrak's `elements` group endpoint.
 * `OBJECT_NAME` is the satellite name, `NORAD_CAT_ID` the catalogue
 * number, `OBJECT_TYPE` the object category, and `TLE_LINE1` the first
 * line of the two-line element set used to propagate the orbit.
 */
export interface SatelliteRecord {
  OBJECT_NAME?: string;
  NORAD_CAT_ID?: number;
  OBJECT_TYPE?: string;
  TLE_LINE1?: string;
}

/**
 * One OpenSky state vector: a positional array laid out as
 * `[icao24, callsign, origin_country, time_position, last_contact,
 * longitude, latitude, baro_altitude, on_ground, velocity, true_track,
 * vertical_rate, sensors, geo_altitude, squawk, spi, position_source]`.
 * Every slot may be null because OpenSky blanks the values it does not have.
 */
export type FlightState = (string | number | null)[];

/**
 * Envelope of an Overture Maps theme query: a `features` array of GeoJSON
 * features (place, building, segment and land/water records) inside the
 * requested bounding box.
 */
export interface OvertureResponse {
  features: unknown[];
}

/**
 * Loose envelope for the different NOAA-family payloads the Explorer loads -
 * a GeoJSON `features` array (ArcGIS alerts, USGS quakes), a `properties`
 * block holding `periods` and `forecastGenerator` (NWS forecast),
 * `activeStorms` (NHC) and `events` (NASA EONET). Only the fields
 * belonging to the selected dataset are present.
 */
export interface NoaaData {
  features?: GeoFeature[];
  metadata?: { generated?: number };
  properties?: { periods?: NoaaForecastPeriod[]; forecastGenerator?: string };
  activeStorms?: unknown[];
  events?: EonetEvent[];
}

/**
 * The Explorer's flights payload: the upstream reference `time` in Unix
 * seconds, the (possibly filtered) `states` array of OpenSky state vectors,
 * and `totalRaw` - the unfiltered count from before the on-ground/airborne
 * filter was applied.
 */
export interface FlightResponse {
  time: number;
  states: FlightState[];
  totalRaw: number;
}

/**
 * The `current` block of an Open-Meteo marine API response. Wave, wind-wave
 * and swell heights are metres, their directions degrees and their periods
 * seconds; the 10 m wind speed and gusts are km/h, the 10 m wind direction
 * degrees, and the 2 m air temperature is degrees Celsius.
 */
export interface MarineCurrent {
  time?: string;
  wave_height?: number;
  wave_direction?: number;
  wave_period?: number;
  wind_wave_height?: number;
  wind_wave_direction?: number;
  wind_wave_period?: number;
  swell_wave_height?: number;
  swell_wave_direction?: number;
  swell_wave_period?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
  temperature_2m?: number;
}

/**
 * Envelope of an Open-Meteo marine API response, carrying the observation in
 * `current`.
 */
export interface MarineResponse {
  current?: MarineCurrent;
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

/**
 * Identifier of an Explorer tab: `overture`, `overpass`, `noaa`, `flights`,
 * `earthquakes`, `satellites` or `marine`.
 */
export type TabId = "overture" | "overpass" | "noaa" | "flights" | "earthquakes" | "satellites" | "marine";

/**
 * Catalogue of the Explorer tabs in display order — each entry carries the tab
 * `id`, the button label and the glyph shown in it. The page indexes this
 * array with the number keys to select a tab and cycles through it with the
 * arrow keys.
 */
// Tab configs (module-const: static data, stable identity for effects)
export const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "noaa", label: "NOAA & USGS", icon: "🌊" },
  { id: "flights", label: "Flights", icon: "✈️" },
  { id: "earthquakes", label: "Earthquakes", icon: "💥" },
  { id: "satellites", label: "Satellites", icon: "🛰️" },
  { id: "marine", label: "Marine", icon: "🚢" },
  { id: "overpass", label: "Overpass / OSM", icon: "🔍" },
  { id: "overture", label: "Overture Maps", icon: "🌐" },
];

/**
 * Overture Maps theme catalogue: each entry names a theme (`places`,
 * `buildings`, `transportation`, `base_geography`), describes what it
 * covers, and lists the Overture `types` the Explorer requests inside it.
 */
export const OVERTURE_THEMES = [
  { id: "places", label: "Places", desc: "Points of interest, businesses, landmarks", types: ["place"] },
  { id: "buildings", label: "Buildings", desc: "Building footprints with height and type", types: ["building"] },
  { id: "transportation", label: "Transportation", desc: "Roads, paths, and transit segments", types: ["segment"] },
  {
    id: "base_geography",
    label: "Base Geography",
    desc: "Land, water, and administrative boundaries",
    types: ["land", "water"],
  },
];

/**
 * Preset Overpass QL queries the Explorer offers. Each `query` contains the
 * `{{bbox}}` placeholder, which the Explorer replaces with the user's
 * west,south,east,north bounding box before POSTing it to `/api/overpass`.
 */
export const OVERPASS_QUERIES = [
  {
    label: "Amenities in view",
    query:
      '[out:json][timeout:25];({node["amenity"]({{bbox}});way["amenity"]({{bbox}});relation["amenity"]({{bbox}});});out center;',
  },
  { label: "Power lines", query: '[out:json][timeout:25];way["power"="line"]({{bbox}});out geom;' },
  { label: "Waterways", query: '[out:json][timeout:25];way["waterway"]({{bbox}});out geom;' },
  { label: "Buildings", query: '[out:json][timeout:25];way["building"]({{bbox}});out geom;(._<;);out skel qt 50;' },
  { label: "Roads", query: '[out:json][timeout:25];way["highway"]({{bbox}});out geom;' },
  { label: "Aerialways", query: '[out:json][timeout:25];way["aerialway"]({{bbox}});out geom;' },
  {
    label: "Natural features",
    query: '[out:json][timeout:25];(node["natural"]({{bbox}});way["natural"]({{bbox}}););out center;',
  },
  {
    label: "Historic sites",
    query: '[out:json][timeout:25];(node["historic"]({{bbox}});way["historic"]({{bbox}}););out center;',
  },
  { label: "Railways", query: '[out:json][timeout:25];way["railway"]({{bbox}});out geom;' },
  { label: "Landuse", query: '[out:json][timeout:25];way["landuse"]({{bbox}});out geom;' },
];

/**
 * Catalogue of the NOAA/NWS/USGS/NHC/NASA datasets the Explorer can load,
 * each with a label, a short description and its source. `url` is the
 * upstream to fetch; it is null for the two point-based NWS datasets
 * (forecast and active alerts), which are queried with the user's latitude
 * and longitude instead.
 */
export const NOAA_DATASETS = [
  {
    label: "NWS Weather Warnings",
    url: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/NWS_Watch_Warn_Advisory/FeatureServer/0/query?f=json&where=1%3D1&returnGeometry=true&outFields=*&resultRecordCount=100",
    desc: "Watches, warnings, and advisories with polygon boundaries from NOAA NWS.",
    source: "ArcGIS",
  },
  {
    label: "NHC Active Cyclones",
    url: "https://www.nhc.noaa.gov/CurrentStorms.json",
    desc: "Active tropical cyclone data from the National Hurricane Center.",
    source: "NHC",
  },
  {
    label: "USGS All Earthquakes (7 days)",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    desc: "All earthquakes in the past day from USGS.",
    source: "USGS",
  },
  {
    label: "USGS M4.5+ (7 days)",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
    desc: "Significant earthquakes M4.5+ in the past week.",
    source: "USGS",
  },
  {
    label: "USGS M2.5+ (7 days)",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
    desc: "Moderate earthquakes M2.5+ in the past week.",
    source: "USGS",
  },
  {
    label: "NASA EONET Events",
    url: "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100",
    desc: "Open natural events: volcanoes, wildfires, icebergs, landslides.",
    source: "NASA",
  },
  {
    label: "NWS Point Forecast",
    url: null,
    desc: "7-day weather forecast for a specific latitude/longitude point. Requires coordinates.",
    source: "NWS",
  },
  {
    label: "NWS Alerts by Point",
    url: null,
    desc: "Active weather alerts for a specific location. Requires coordinates.",
    source: "NWS",
  },
];

/**
 * Catalogue of the Celestrak `elements` groups the Explorer can query -
 * active satellites, visual, communication, GNSS, weather, Earth-observation,
 * science, space stations and education - each with the label shown in the
 * picker and the `GROUP` id sent to Celestrak.
 */
export const SATELLITE_GROUPS = [
  { label: "Active (all)", id: "active" },
  { label: "Visible", id: "visual" },
  { label: "Communication", id: "communication" },
  { label: "Navigation (GPS)", id: "gnss" },
  { label: "Weather", id: "weather" },
  { label: "Earth Observation", id: "earth-observation" },
  { label: "Science", id: "science" },
  { label: "Space Stations", id: "space-stations" },
  { label: "Education", id: "education" },
];

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

/**
 * Fetches an arbitrary upstream URL through the app's `/api/proxy` route,
 * percent-encoding the URL into the path. Rejects with `HTTP <status>` when
 * the proxy answers with a non-2xx status; resolves to parsed JSON when the
 * response content type includes `json` or `geojson`, and to the raw text
 * otherwise.
 */
export function proxyFetch(url: string): Promise<unknown> {
  return fetch(`/api/proxy/${encodeURIComponent(url)}`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("geojson") || ct.includes("json")) return r.json();
    return r.text();
  });
}

/* Magnitude chips put colored digits on a 15% tint of the same hue, so the
   digits use light shades to stay above the AAA 7:1 bar on the blended tint. */
/**
 * Foreground colour for an earthquake magnitude chip. Magnitude 7+ uses a
 * light red, 5-7 orange, 3-5 yellow, 1-3 green and below 1 blue - each
 * shade chosen to stay above the 7:1 contrast bar on the 15 %-opacity
 * background `magBg` returns for the same magnitude.
 */
export function magColor(mag: number): string {
  if (mag >= 7) return "#fca5a5"; /* 8.50:1 on #311a22 */
  if (mag >= 5) return "#fdba74"; /* 9.10:1 on #32211b */
  if (mag >= 3) return "#fde047"; /* 10.73:1 on #302b19 */
  if (mag >= 1) return "#34d399"; /* 7.56:1 on #122e26 */
  return "#7cb8ff"; /* 7.19:1 on #18283e */
}

/**
 * Background tint for an earthquake magnitude chip: a 15 %-opacity red,
 * orange, yellow, green or blue that matches the band `magColor` picks for
 * the same magnitude.
 */
export function magBg(mag: number): string {
  if (mag >= 7) return "rgba(239,68,68,0.15)";
  if (mag >= 5) return "rgba(249,115,22,0.15)";
  if (mag >= 3) return "rgba(234,179,8,0.15)";
  if (mag >= 1) return "rgba(34,197,94,0.15)";
  return "rgba(74,158,255,0.15)";
}
