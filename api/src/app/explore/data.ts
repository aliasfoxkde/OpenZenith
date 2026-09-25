/**
 * Data Explorer shared data: API response types, tab/dataset catalogs, and
 * fetch/format helpers. Moved verbatim from explore/page.tsx so the tab
 * components (explore/tabs/) and the page share one definition.
 */

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

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

export interface OverpassResult {
  elements: OverpassElement[];
  osm3s?: { timestamp_osm_base: string };
}

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

export interface GeoFeature {
  properties: GeoFeatureProperties;
  geometry?: GeoFeatureGeometry;
}

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

export interface NwsAlertProperties {
  severity?: string;
  event?: string;
  title?: string;
  areaDesc?: string;
  headline?: string;
}

export interface EonetEvent {
  title?: string;
  categories?: { title?: string; color?: string; id?: string }[];
  sources?: { id?: string; url?: string }[];
  geometry?: {
    type?: string;
    coordinates?: number[][][][] | number[][];
  };
}

export interface SatelliteRecord {
  OBJECT_NAME?: string;
  NORAD_CAT_ID?: number;
  OBJECT_TYPE?: string;
  TLE_LINE1?: string;
}

export type FlightState = (string | number | null)[];

export interface OvertureResponse {
  features: unknown[];
}

export interface NoaaData {
  features?: GeoFeature[];
  metadata?: { generated?: number };
  properties?: { periods?: NoaaForecastPeriod[]; forecastGenerator?: string };
  activeStorms?: unknown[];
  events?: EonetEvent[];
}

export interface FlightResponse {
  time: number;
  states: FlightState[];
  totalRaw: number;
}

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

export interface MarineResponse {
  current?: MarineCurrent;
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

export type TabId = "overture" | "overpass" | "noaa" | "flights" | "earthquakes" | "satellites" | "marine";

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
export function magColor(mag: number): string {
  if (mag >= 7) return "#fca5a5"; /* 8.50:1 on #311a22 */
  if (mag >= 5) return "#fdba74"; /* 9.10:1 on #32211b */
  if (mag >= 3) return "#fde047"; /* 10.73:1 on #302b19 */
  if (mag >= 1) return "#34d399"; /* 7.56:1 on #122e26 */
  return "#7cb8ff"; /* 7.19:1 on #18283e */
}

export function magBg(mag: number): string {
  if (mag >= 7) return "rgba(239,68,68,0.15)";
  if (mag >= 5) return "rgba(249,115,22,0.15)";
  if (mag >= 3) return "rgba(234,179,8,0.15)";
  if (mag >= 1) return "rgba(34,197,94,0.15)";
  return "rgba(74,158,255,0.15)";
}
