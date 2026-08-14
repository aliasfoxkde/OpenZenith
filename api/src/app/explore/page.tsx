"use client";

import { useState, useCallback, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface OverpassElement {
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

interface OverpassResult {
  elements: OverpassElement[];
  osm3s?: { timestamp_osm_base: string };
}

interface GeoFeatureProperties {
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

interface GeoFeature {
  properties: GeoFeatureProperties;
  geometry?: GeoFeatureGeometry;
}

interface NoaaForecastPeriod {
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  name?: string;
  shortForecast?: string;
  windSpeed?: string;
  windDirection?: string;
  startTime?: string;
}

interface NwsAlertProperties {
  severity?: string;
  event?: string;
  title?: string;
  areaDesc?: string;
  headline?: string;
}

interface EonetEvent {
  title?: string;
  categories?: { title?: string; color?: string; id?: string }[];
  sources?: { id?: string; url?: string }[];
  geometry?: {
    type?: string;
    coordinates?: number[][][][] | number[][];
  };
}

interface SatelliteRecord {
  OBJECT_NAME?: string;
  NORAD_CAT_ID?: number;
  OBJECT_TYPE?: string;
  TLE_LINE1?: string;
}

type FlightState = (string | number | null)[];

interface OvertureResponse {
  features: unknown[];
}

interface NoaaData {
  features?: GeoFeature[];
  metadata?: { generated?: number };
  properties?: { periods?: NoaaForecastPeriod[]; forecastGenerator?: string };
  activeStorms?: unknown[];
  events?: EonetEvent[];
}

interface FlightResponse {
  time: number;
  states: FlightState[];
  totalRaw: number;
}

interface MarineCurrent {
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

interface MarineResponse {
  current?: MarineCurrent;
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const OVERTURE_THEMES = [
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

const OVERPASS_QUERIES = [
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

const NOAA_DATASETS = [
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

const SATELLITE_GROUPS = [
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
   CSS
   ═══════════════════════════════════════════════════════════════ */

const S = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
.ex-wrap{position:relative;width:100vw;min-height:100vh;overflow-x:hidden;font-family:system-ui,-apple-system,sans-serif;color:#e0e0e0;background:#0a0e17}
.ex-body{padding:1.5rem 2rem 3rem;max-width:1600px;margin:0 auto}
.ex-body h1{font-size:1.5rem;font-weight:700;margin:0 0 0.25rem;letter-spacing:-0.02em}
.ex-body .sub{color:#555;font-size:0.85rem;margin:0 0 1.5rem}
.ex-body h2{font-size:1.05rem;font-weight:600;margin:1.5rem 0 0.75rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(255,255,255,0.06)}
.ex-body h3{font-size:0.9rem;font-weight:600;margin:1rem 0 0.5rem}
.ex-body a{color:#4a9eff;text-decoration:none}
.ex-body a:hover{text-decoration:underline}
.ex-body input,.ex-body textarea,.ex-body select{background:#0d1117;color:#e0e0e0;border:1px solid #222;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.85rem;font-family:inherit;outline:none;width:100%;box-sizing:border-box;transition:border-color .15s}
.ex-body input:focus,.ex-body textarea:focus{border-color:#4a9eff}
.ex-body button{padding:0.45rem 1rem;border-radius:6px;border:none;font-size:0.85rem;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s}
.ex-body button:hover{opacity:0.85}
.ex-body button:disabled{opacity:0.4;cursor:not-allowed}
.ex-body button.primary{background:#4a9eff;color:#000}
.ex-body button.secondary{background:rgba(255,255,255,0.04);color:#ccc;border:1px solid #222}
.ex-body button.danger{background:#ef4444;color:#fff}
.ex-body pre{background:#0d1117;border:1px solid #1a1a1a;border-radius:8px;padding:0.75rem 1rem;font-size:0.78rem;line-height:1.6;overflow:auto;max-height:500px;color:#aaa;font-family:'JetBrains Mono',monospace}
.ex-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:0.75rem}
.ex-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:1rem;transition:border-color .15s}
.ex-card:hover{border-color:rgba(255,255,255,0.12)}
.ex-badge{display:inline-block;padding:0.1rem 0.5rem;border-radius:4px;font-size:0.7rem;font-weight:500}
.ex-badge.fs{background:rgba(74,158,255,0.12);color:#4a9eff}
.ex-badge.ms{background:rgba(168,85,247,0.12);color:#a855f7}
.ex-badge.ts{background:rgba(34,197,94,0.12);color:#22c55e}
.ex-badge.is{background:rgba(251,146,60,0.12);color:#fb923c}
.ex-badge.wms{background:rgba(234,179,8,0.12);color:#eab308}
.ex-badge.err{background:rgba(239,68,68,0.12);color:#ef4444}
.ex-badge.noaa{background:rgba(56,189,248,0.12);color:#38bdf8}
.ex-badge.usgs{background:rgba(239,68,68,0.12);color:#ef4444}
.ex-badge.nasa{background:rgba(34,197,94,0.12);color:#22c55e}
.ex-badge.flight{background:rgba(251,146,60,0.12);color:#fb923c}
.ex-badge.sat{background:rgba(6,182,212,0.12);color:#06b6d4}
.ex-badge.marine{background:rgba(59,130,246,0.12);color:#3b82f6}
.ex-stat{display:flex;align-items:center;gap:0.5rem;margin:0.25rem 0;font-size:0.8rem}
.ex-stat .num{color:#4a9eff;font-weight:600;font-family:'JetBrains Mono',monospace}
.ex-row{display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap}
.ex-tag{font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;background:rgba(255,255,255,0.03);color:#666;border:1px solid #1a1a1a}
.ex-sep{width:1px;height:16px;background:#1a1a1a;margin:0 0.25rem}
.ex-empty{text-align:center;padding:2rem;color:#444;font-size:0.85rem}
.ex-query-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.5rem;margin-bottom:1rem}
.ex-query-btn{padding:0.4rem 0.6rem;font-size:0.78rem;background:rgba(255,255,255,0.02);color:#888;border:1px solid #1a1a1a;border-radius:6px;cursor:pointer;text-align:left;transition:all .15s;font-family:inherit}
.ex-query-btn:hover{border-color:#4a9eff;color:#4a9eff;background:rgba(74,158,255,0.05)}
.ex-tabs{display:flex;gap:0.25rem;margin-bottom:1.25rem;background:rgba(255,255,255,0.02);border-radius:8px;padding:3px;border:1px solid rgba(255,255,255,0.06);flex-wrap:wrap}
.ex-tab{padding:0.4rem 0.8rem;border-radius:6px;border:none;font-size:0.78rem;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s;background:transparent;color:#666;white-space:nowrap}
.ex-tab:hover{color:#aaa}
.ex-tab.active{background:rgba(74,158,255,0.12);color:#4a9eff}
.ex-toolbar{display:flex;gap:0.5rem;align-items:center;margin-bottom:1rem;padding:0.75rem 1rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;flex-wrap:wrap}
.ex-toolbar input{flex:1;min-width:120px}
.ex-info-bar{display:flex;gap:1rem;align-items:center;padding:0.5rem 0;margin-bottom:1rem;font-size:0.8rem;color:#555;border-bottom:1px solid rgba(255,255,255,0.04);padding-bottom:0.75rem;flex-wrap:wrap}
.ex-ds-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0.75rem}
.ex-ds-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:1rem;cursor:pointer;transition:all .15s}
.ex-ds-card:hover{border-color:rgba(74,158,255,0.3);background:rgba(74,158,255,0.03)}
.ex-ds-card.selected{border-color:rgba(74,158,255,0.5);background:rgba(74,158,255,0.06)}
.ex-flight-table{width:100%;border-collapse:collapse;font-size:0.78rem}
.ex-flight-table th{text-align:left;padding:0.4rem 0.6rem;color:#666;font-weight:500;border-bottom:1px solid #1a1a1a;position:sticky;top:0;background:#0a0e17}
.ex-flight-table td{padding:0.35rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.03);color:#bbb;font-family:'JetBrains Mono',monospace}
.ex-flight-table tr:hover td{background:rgba(74,158,255,0.04)}
.ex-quake-list{display:flex;flex-direction:column;gap:0.4rem}
.ex-quake-item{display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;transition:border-color .15s}
.ex-quake-item:hover{border-color:rgba(239,68,68,0.3)}
.ex-quake-mag{width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;flex-shrink:0;font-family:'JetBrains Mono',monospace}
.ex-filter-group{display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap}
.ex-filter-group label{font-size:0.75rem;color:#666;white-space:nowrap}
.ex-filter-group input{width:100px;flex:none}
.ex-filter-group select{width:auto;flex:none;background:#0d1117;color:#e0e0e0;border:1px solid #222;border-radius:6px;padding:0.4rem 0.6rem;font-size:0.82rem;font-family:inherit;outline:none}
@media(max-width:768px){
  .ex-body{padding:1rem}
  .ex-grid,.ex-ds-grid{grid-template-columns:1fr}
  .ex-nav{padding:0 0.75rem}
  .ex-query-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
  .ex-filter-group input{width:80px}
  .ex-tabs{gap:0.15rem}
  .ex-tab{padding:0.35rem 0.5rem;font-size:0.72rem}
}
`;

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function proxyFetch(url: string): Promise<unknown> {
  return fetch(`/api/proxy/${encodeURIComponent(url)}`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("geojson") || ct.includes("json")) return r.json();
    return r.text();
  });
}

function magColor(mag: number): string {
  if (mag >= 7) return "#ef4444";
  if (mag >= 5) return "#f97316";
  if (mag >= 3) return "#eab308";
  if (mag >= 1) return "#22c55e";
  return "#4a9eff";
}

function magBg(mag: number): string {
  if (mag >= 7) return "rgba(239,68,68,0.15)";
  if (mag >= 5) return "rgba(249,115,22,0.15)";
  if (mag >= 3) return "rgba(234,179,8,0.15)";
  if (mag >= 1) return "rgba(34,197,94,0.15)";
  return "rgba(74,158,255,0.15)";
}

/* ═══════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════ */

type TabId = "overture" | "overpass" | "noaa" | "flights" | "earthquakes" | "satellites" | "marine";

export default function ExplorePage() {
  const [tab, setTab] = useState<TabId>("noaa");

  // Overture Maps state
  const [ovTheme, setOvTheme] = useState("places");
  const [ovType, setOvType] = useState("place");
  const [ovBbox, setOvBbox] = useState("-74.02,40.70,-73.95,40.78");
  const [ovLoading, setOvLoading] = useState(false);
  const [ovData, setOvData] = useState<OvertureResponse | null>(null);
  const [ovError, setOvError] = useState("");

  // Overpass state
  const [opQuery, setOpQuery] = useState("");
  const [opBbox, setOpBbox] = useState("-74.02,40.70,-73.95,40.78");
  const [opResult, setOpResult] = useState<OverpassResult | null>(null);
  const [opLoading, setOpLoading] = useState(false);
  const [opError, setOpError] = useState("");
  const [opStats, setOpStats] = useState<{ nodes: number; ways: number; relations: number }>({
    nodes: 0,
    ways: 0,
    relations: 0,
  });

  // NOAA state
  const [noaaLoading, setNoaaLoading] = useState(false);
  const [noaaData, setNoaaData] = useState<NoaaData | null>(null);
  const [noaaError, setNoaaError] = useState("");
  const [noaaSelected, setNoaaSelected] = useState(0);
  const [nwsLat, setNwsLat] = useState("40.7128");
  const [nwsLon, setNwsLon] = useState("-74.0060");

  // Flights state
  const [flLoading, setFlLoading] = useState(false);
  const [flData, setFlData] = useState<FlightResponse | null>(null);
  const [flError, setFlError] = useState("");
  const [flCallsign, setFlCallsign] = useState("");
  const [flAltMin, setFlAltMin] = useState("");
  const [flAltMax, setFlAltMax] = useState("");
  const [flBbox, setFlBbox] = useState("-122.5,37.7,-122.3,37.8");
  const [flOnGround, setFlOnGround] = useState<"all" | "airborne" | "ground">("all");

  // Earthquakes state
  const [eqLoading, setEqLoading] = useState(false);
  const [eqData, setEqData] = useState<NoaaData | null>(null);
  const [eqError, setEqError] = useState("");
  const [eqPeriod, setEqPeriod] = useState("day");
  const [eqMinMag, setEqMinMag] = useState("2.5");

  // Satellites state
  const [satLoading, setSatLoading] = useState(false);
  const [satData, setSatData] = useState<SatelliteRecord[] | null>(null);
  const [satError, setSatError] = useState("");
  const [satGroup, setSatGroup] = useState("active");
  const [satSearch, setSatSearch] = useState("");

  // Marine state
  const [marLoading, setMarLoading] = useState(false);
  const [marData, setMarData] = useState<MarineResponse | null>(null);
  const [marError, setMarError] = useState("");
  const [marLat, setMarLat] = useState("40.7128");
  const [marLon, setMarLon] = useState("-74.0060");

  // ─── Overture Maps ───
  const fetchOverture = useCallback(async () => {
    if (!ovBbox.trim()) return;
    setOvLoading(true);
    setOvError("");
    setOvData(null);
    try {
      const parts = ovBbox.split(",").map(Number);
      if (parts.length !== 4 || parts.some(isNaN)) throw new Error("Invalid bbox. Use: west,south,east,north");
      const [west, south, east, north] = parts;
      const url = `https://api.overturemaps.org/v0/${ovTheme}/${ovType}?bbox=${west},${south},${east},${north}`;
      const data = await proxyFetch(url);
      setOvData(data as OvertureResponse);
    } catch (e: unknown) {
      setOvError(e instanceof Error ? e.message : "Overture Maps fetch failed");
    } finally {
      setOvLoading(false);
    }
  }, [ovTheme, ovType, ovBbox]);

  // ─── Overpass ───
  const runOverpass = useCallback(async () => {
    if (!opQuery.trim()) return;
    setOpLoading(true);
    setOpError("");
    setOpResult(null);
    try {
      const resolvedQuery = opQuery.replace(/\{\{bbox\}\}/g, opBbox);
      const resp = await fetch("/api/overpass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: resolvedQuery }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      if (data.remark) throw new Error(data.remark);
      setOpResult(data);
      const els = data.elements || [];
      setOpStats({
        nodes: els.filter((e: OverpassElement) => e.type === "node").length,
        ways: els.filter((e: OverpassElement) => e.type === "way").length,
        relations: els.filter((e: OverpassElement) => e.type === "relation").length,
      });
    } catch (e: unknown) {
      setOpError(e instanceof Error ? e.message : "Overpass query failed");
    } finally {
      setOpLoading(false);
    }
  }, [opQuery, opBbox]);

  // ─── NOAA ───
  const fetchNoaa = useCallback(
    async (idx?: number) => {
      const i = idx ?? noaaSelected;
      const ds = NOAA_DATASETS[i];
      if (!ds) return;
      if (ds.url === null) {
        // Point-based: NWS forecast or alerts
        if (ds.label.includes("Point Forecast")) {
          setNoaaLoading(true);
          setNoaaError("");
          setNoaaData(null);
          try {
            const lat = parseFloat(nwsLat);
            const lon = parseFloat(nwsLon);
            if (isNaN(lat) || isNaN(lon)) throw new Error("Invalid coordinates");
            // Get gridpoint
            const gpResp = (await proxyFetch(`https://api.weather.gov/points/${lat},${lon}`)) as Record<
              string,
              unknown
            > | null;
            if (gpResp?.properties && typeof gpResp.properties === "object") {
              const props = gpResp.properties as Record<string, unknown>;
              if (typeof props.forecastHourly === "string") {
                const fcResp = await proxyFetch(props.forecastHourly);
                setNoaaData(fcResp as NoaaData);
              } else {
                setNoaaData(gpResp as unknown as NoaaData);
              }
            } else {
              setNoaaData(gpResp as unknown as NoaaData);
            }
          } catch (e: unknown) {
            setNoaaError(e instanceof Error ? e.message : "NWS fetch failed");
          } finally {
            setNoaaLoading(false);
          }
        } else if (ds.label.includes("Alerts")) {
          setNoaaLoading(true);
          setNoaaError("");
          setNoaaData(null);
          try {
            const lat = parseFloat(nwsLat);
            const lon = parseFloat(nwsLon);
            if (isNaN(lat) || isNaN(lon)) throw new Error("Invalid coordinates");
            const data = await proxyFetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`);
            setNoaaData(data as NoaaData);
          } catch (e: unknown) {
            setNoaaError(e instanceof Error ? e.message : "NWS alerts fetch failed");
          } finally {
            setNoaaLoading(false);
          }
        }
        return;
      }
      setNoaaLoading(true);
      setNoaaError("");
      setNoaaData(null);
      try {
        const data = await proxyFetch(ds.url);
        setNoaaData(data as NoaaData);
      } catch (e: unknown) {
        setNoaaError(e instanceof Error ? e.message : "Fetch failed");
      } finally {
        setNoaaLoading(false);
      }
    },
    [noaaSelected, nwsLat, nwsLon],
  );

  // ─── Flights ───
  const fetchFlights = useCallback(async () => {
    setFlLoading(true);
    setFlError("");
    setFlData(null);
    try {
      let url = "/api/flights?";
      const params = new URLSearchParams();
      if (flBbox) {
        const [lomin, lamin, lomax, lamax] = flBbox.split(",").map(Number);
        if (!lomin || !lamin || !lomax || !lamax) throw new Error("Invalid bbox format: west,south,east,north");
        params.set("lomin", String(lomin));
        params.set("lamin", String(lamin));
        params.set("lomax", String(lomax));
        params.set("lamax", String(lamax));
      }
      url += params.toString();
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      // Filter client-side
      let states = data.states || [];
      if (flCallsign.trim()) {
        const cs = flCallsign.trim().toUpperCase();
        states = states.filter((s: FlightState) =>
          String(s[1] || "")
            .toUpperCase()
            .includes(cs),
        );
      }
      if (flAltMin || flAltMax) {
        states = states.filter((s: FlightState) => {
          const alt = s[7]; // baro_altitude
          if (alt === null || typeof alt !== "number") return false;
          if (flAltMin && alt < parseFloat(flAltMin)) return false;
          if (flAltMax && alt > parseFloat(flAltMax)) return false;
          return true;
        });
      }
      if (flOnGround === "airborne") states = states.filter((s: FlightState) => !s[8]);
      if (flOnGround === "ground") states = states.filter((s: FlightState) => s[8]);
      setFlData({ time: data.time, states, totalRaw: (data.states || []).length });
    } catch (e: unknown) {
      setFlError(e instanceof Error ? e.message : "Flight fetch failed");
    } finally {
      setFlLoading(false);
    }
  }, [flBbox, flCallsign, flAltMin, flAltMax, flOnGround]);

  // ─── Earthquakes ───
  const fetchEarthquakes = useCallback(async () => {
    setEqLoading(true);
    setEqError("");
    setEqData(null);
    try {
      const minMag = parseFloat(eqMinMag) || 0;
      const data = await proxyFetch(
        `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${minMag}_${eqPeriod}.geojson`,
      );
      setEqData(data as NoaaData);
    } catch (e: unknown) {
      setEqError(e instanceof Error ? e.message : "Earthquake fetch failed");
    } finally {
      setEqLoading(false);
    }
  }, [eqPeriod, eqMinMag]);

  // ─── Satellites ───
  const fetchSatellites = useCallback(async () => {
    setSatLoading(true);
    setSatError("");
    setSatData(null);
    try {
      const data = await proxyFetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${satGroup}&FORMAT=json`);
      setSatData(data as SatelliteRecord[]);
    } catch (e: unknown) {
      setSatError(e instanceof Error ? e.message : "Satellite fetch failed");
    } finally {
      setSatLoading(false);
    }
  }, [satGroup]);

  // ─── Marine ───
  const fetchMarine = useCallback(async () => {
    setMarLoading(true);
    setMarError("");
    setMarData(null);
    try {
      const lat = parseFloat(marLat);
      const lon = parseFloat(marLon);
      if (isNaN(lat) || isNaN(lon)) throw new Error("Invalid coordinates");
      const data = await proxyFetch(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m&timezone=auto`,
      );
      setMarData(data as MarineResponse);
    } catch (e: unknown) {
      setMarError(e instanceof Error ? e.message : "Marine fetch failed");
    } finally {
      setMarLoading(false);
    }
  }, [marLat, marLon]);

  // ─── Helpers ───
  const selectedOvertureTheme = OVERTURE_THEMES.find((t) => t.id === ovTheme);

  // Tab configs
  const TABS: { id: TabId; label: string; icon: string }[] = [
    { id: "noaa", label: "NOAA & USGS", icon: "\uD83C\uDF0A" },
    { id: "flights", label: "Flights", icon: "\u2708\uFE0F" },
    { id: "earthquakes", label: "Earthquakes", icon: "\uD83D\uDCA5" },
    { id: "satellites", label: "Satellites", icon: "\uD83D\uDEF0\uFE0F" },
    { id: "marine", label: "Marine", icon: "\uD83D\uDEA2" },
    { id: "overpass", label: "Overpass / OSM", icon: "\uD83D\uDD0D" },
    { id: "overture", label: "Overture Maps", icon: "\uD83C\uDF10" },
  ];

  // Keyboard shortcuts: number keys switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= TABS.length) {
        setTab(TABS[num - 1].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <ErrorBoundary>
      <div className="ex-wrap">
        <style dangerouslySetInnerHTML={{ __html: S }} />

        {/* Nav */}
        <Navbar dark breadcrumb="Explore" />

        <div className="ex-body">
          <h1>Data Explorer</h1>
          <p className="sub">
            Search, filter, and explore geospatial data from NOAA, USGS, NASA, OpenSky, Celestrak, and more
          </p>

          {/* Tabs */}
          <div className="ex-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`ex-tab ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ═══ NOAA & USGS TAB ═══ */}
          <div role="tabpanel" aria-label="Explore data panel">
            {tab === "noaa" && (
              <>
                <h2>NOAA &amp; USGS Data Sources</h2>
                <p style={{ fontSize: "0.8rem", color: "#555", margin: "0 0 1rem" }}>
                  Access weather warnings, hurricane data, earthquake feeds, and NASA natural events via our CORS proxy.
                </p>

                <div className="ex-ds-grid" style={{ marginBottom: "1.25rem" }}>
                  {NOAA_DATASETS.map((ds, i) => (
                    <div
                      key={i}
                      className={`ex-ds-card ${noaaSelected === i ? "selected" : ""}`}
                      onClick={() => {
                        setNoaaSelected(i);
                        setNoaaData(null);
                        setNoaaError("");
                      }}
                    >
                      <div className="ex-row" style={{ marginBottom: "0.4rem" }}>
                        <span
                          className={`ex-badge ${ds.source === "USGS" ? "usgs" : ds.source === "NASA" ? "nasa" : "noaa"}`}
                        >
                          {ds.source}
                        </span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.2rem" }}>{ds.label}</div>
                      <div style={{ fontSize: "0.78rem", color: "#666", lineHeight: 1.45 }}>{ds.desc}</div>
                      {ds.url === null && (
                        <div className="ex-row" style={{ marginTop: "0.5rem", gap: "0.3rem" }}>
                          <input
                            style={{ width: 90, fontSize: "0.78rem", padding: "0.3rem 0.5rem" }}
                            placeholder="lat"
                            aria-label="NWS alert latitude"
                            value={nwsLat}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setNwsLat(e.target.value)}
                          />
                          <input
                            style={{ width: 90, fontSize: "0.78rem", padding: "0.3rem 0.5rem" }}
                            placeholder="lon"
                            aria-label="NWS alert longitude"
                            value={nwsLon}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setNwsLon(e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="ex-row">
                  <button className="primary" onClick={() => fetchNoaa()} disabled={noaaLoading}>
                    {noaaLoading ? "Fetching..." : "Fetch Data"}
                  </button>
                  <span style={{ fontSize: "0.72rem", color: "#444" }}>Via /api/proxy</span>
                </div>

                {noaaError && (
                  <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
                    <span className="ex-badge err">Error</span> {noaaError}
                  </div>
                )}

                {noaaData && (
                  <div style={{ marginTop: "1rem" }}>
                    <h3>Results: {NOAA_DATASETS[noaaSelected].label}</h3>
                    {/* Earthquakes GeoJSON */}
                    {noaaData.features && (
                      <div>
                        <div className="ex-stat">
                          <span className="num">{noaaData.features.length}</span> features
                        </div>
                        {noaaData.metadata?.generated && (
                          <div className="ex-stat">
                            <span style={{ color: "#555" }}>Generated:</span>{" "}
                            {new Date(noaaData.metadata.generated).toLocaleString()}
                          </div>
                        )}
                        <div className="ex-quake-list" style={{ marginTop: "0.5rem" }}>
                          {noaaData.features.slice(0, 60).map((f: GeoFeature, i: number) => {
                            const p = f.properties;
                            const coords = f.geometry?.coordinates as number[] | undefined;
                            const mag = p.mag || p.magnitude;
                            return (
                              <div key={i} className="ex-quake-item">
                                {mag != null && (
                                  <div
                                    className="ex-quake-mag"
                                    style={{ color: magColor(mag), background: magBg(mag) }}
                                  >
                                    {mag.toFixed(1)}
                                  </div>
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: "0.82rem",
                                      fontWeight: 500,
                                      color: "#ccc",
                                      marginBottom: "0.1rem",
                                    }}
                                  >
                                    {p.place || p.title || p.name || p.event || "(unnamed)"}
                                  </div>
                                  <div className="ex-row" style={{ fontSize: "0.72rem", color: "#666" }}>
                                    {coords && (
                                      <span>
                                        {coords[1]?.toFixed(3)}, {coords[0]?.toFixed(3)}
                                      </span>
                                    )}
                                    {p.depth != null && (
                                      <>
                                        <span className="ex-sep" />
                                        <span>
                                          Depth: {typeof p.depth === "number" ? p.depth.toFixed(1) : p.depth} km
                                        </span>
                                      </>
                                    )}
                                    {p.type && (
                                      <>
                                        <span className="ex-sep" />
                                        <span>{p.type}</span>
                                      </>
                                    )}
                                    {p.eventType && (
                                      <>
                                        <span className="ex-sep" />
                                        <span>{p.eventType}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div style={{ fontSize: "0.7rem", color: "#444", whiteSpace: "nowrap" }}>
                                  {p.time ? new Date(p.time).toLocaleString() : ""}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {noaaData.features.length > 60 && (
                          <div className="ex-empty" style={{ padding: "0.75rem" }}>
                            ...and {(noaaData.features.length - 60).toLocaleString()} more
                          </div>
                        )}
                      </div>
                    )}
                    {/* NWS forecast */}
                    {noaaData.properties?.periods && (
                      <div>
                        <div className="ex-stat">
                          <span style={{ color: "#555" }}>Source:</span>{" "}
                          {noaaData.properties.forecastGenerator || "NWS"}
                        </div>
                        <div style={{ marginTop: "0.75rem" }}>
                          {noaaData.properties.periods.slice(0, 48).map((p: NoaaForecastPeriod, i: number) => (
                            <div key={i} className="ex-quake-item">
                              <div style={{ width: 48, textAlign: "center", flexShrink: 0 }}>
                                <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4a9eff" }}>
                                  {p.isDaytime ? "\u2600\uFE0F" : "\uD83C\uDF19"}
                                </div>
                                <div
                                  style={{
                                    fontSize: "0.9rem",
                                    fontWeight: 700,
                                    color: "#e0e0e0",
                                    fontFamily: "'JetBrains Mono',monospace",
                                  }}
                                >
                                  {p.temperature}&deg;{p.temperatureUnit}
                                </div>
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: "0.82rem", fontWeight: 500 }}>{p.name}</div>
                                <div style={{ fontSize: "0.75rem", color: "#888" }}>{p.shortForecast}</div>
                                <div style={{ fontSize: "0.72rem", color: "#555", marginTop: "0.15rem" }}>
                                  {p.windSpeed} {p.windDirection}
                                </div>
                              </div>
                              <div style={{ fontSize: "0.72rem", color: "#555" }}>
                                {p.startTime &&
                                  new Date(p.startTime).toLocaleString([], {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                  })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* NWS alerts */}
                    {Array.isArray(noaaData.features) && noaaData.features[0]?.properties?.severity && (
                      <div>
                        <div className="ex-stat">
                          <span className="num">{noaaData.features.length}</span> active alerts
                        </div>
                        <div className="ex-quake-list" style={{ marginTop: "0.5rem" }}>
                          {noaaData.features.map((f: GeoFeature, i: number) => {
                            const p = f.properties as NwsAlertProperties;
                            const sevColor =
                              p.severity === "Extreme"
                                ? "#ef4444"
                                : p.severity === "Severe"
                                  ? "#f97316"
                                  : p.severity === "Moderate"
                                    ? "#eab308"
                                    : "#4a9eff";
                            return (
                              <div key={i} className="ex-quake-item">
                                <div
                                  style={{ width: 8, height: 40, borderRadius: 4, background: sevColor, flexShrink: 0 }}
                                />
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: "0.82rem", fontWeight: 500, color: "#ccc" }}>
                                    {p.event || p.title}
                                  </div>
                                  <div
                                    className="ex-row"
                                    style={{ fontSize: "0.72rem", color: "#666", marginTop: "0.1rem" }}
                                  >
                                    <span className="ex-badge" style={{ background: `${sevColor}18`, color: sevColor }}>
                                      {p.severity}
                                    </span>
                                    <span>{p.areaDesc?.split(";")?.[0] || ""}</span>
                                  </div>
                                  <div style={{ fontSize: "0.72rem", color: "#555", marginTop: "0.15rem" }}>
                                    {p.headline || ""}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* NHC storms */}
                    {noaaData?.activeStorms && (
                      <div>
                        <div className="ex-stat">
                          <span className="num">{noaaData.activeStorms.length}</span> active storms
                        </div>
                        <pre style={{ marginTop: "0.75rem" }}>{JSON.stringify(noaaData.activeStorms, null, 2)}</pre>
                      </div>
                    )}
                    {/* NASA EONET */}
                    {noaaData?.events && (
                      <div>
                        <div className="ex-stat">
                          <span className="num">{noaaData.events.length}</span> events
                        </div>
                        <div className="ex-quake-list" style={{ marginTop: "0.5rem" }}>
                          {noaaData.events.map((ev: EonetEvent, i: number) => (
                            <div key={i} className="ex-quake-item">
                              <div
                                style={{
                                  width: 8,
                                  height: 40,
                                  borderRadius: 4,
                                  background: ev.categories?.[0]?.color || "#4a9eff",
                                  flexShrink: 0,
                                }}
                              />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: "0.82rem", fontWeight: 500, color: "#ccc" }}>{ev.title}</div>
                                <div
                                  className="ex-row"
                                  style={{ fontSize: "0.72rem", color: "#666", marginTop: "0.1rem" }}
                                >
                                  {ev.categories?.[0]?.title && (
                                    <span className="ex-tag">{ev.categories[0].title}</span>
                                  )}
                                  {ev.sources?.[0]?.id && <span className="ex-tag">{ev.sources[0].id}</span>}
                                </div>
                                {(() => {
                                  const c = ev.geometry?.coordinates;
                                  if (!c || !Array.isArray(c[0]) || !Array.isArray(c[0][0])) return null;
                                  const firstCoord = (c[0] as unknown as number[][])[0];
                                  if (!firstCoord) return null;
                                  return (
                                    <div style={{ fontSize: "0.7rem", color: "#555", marginTop: "0.1rem" }}>
                                      {typeof firstCoord[1] === "number" ? firstCoord[1].toFixed(2) : ""},{" "}
                                      {typeof firstCoord[0] === "number" ? firstCoord[0].toFixed(2) : ""}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Fallback: raw JSON */}
                    {!noaaData.features &&
                      !noaaData.properties?.periods &&
                      !noaaData?.activeStorms &&
                      !noaaData?.events && (
                        <pre style={{ marginTop: "0.75rem" }}>
                          {JSON.stringify(noaaData, null, 2).substring(0, 8000)}
                        </pre>
                      )}
                  </div>
                )}
              </>
            )}

            {/* ═══ FLIGHTS TAB ═══ */}
            {tab === "flights" && (
              <>
                <h2>Flight Tracker (ADS-B)</h2>
                <p style={{ fontSize: "0.8rem", color: "#555", margin: "0 0 1rem" }}>
                  Real-time flight data from OpenSky Network. Filter by callsign, altitude, bounding box, and airborne
                  status.
                </p>

                <div className="ex-filter-group">
                  <label>BBox</label>
                  <input
                    placeholder="west,south,east,north"
                    value={flBbox}
                    onChange={(e) => setFlBbox(e.target.value)}
                    style={{ width: 220 }}
                  />
                  <label>Callsign</label>
                  <input
                    placeholder="UAL, DAL, AAL..."
                    value={flCallsign}
                    onChange={(e) => setFlCallsign(e.target.value)}
                    style={{ width: 120 }}
                  />
                </div>
                <div className="ex-filter-group">
                  <label>Alt Min (m)</label>
                  <input placeholder="0" type="number" value={flAltMin} onChange={(e) => setFlAltMin(e.target.value)} />
                  <label>Alt Max (m)</label>
                  <input
                    placeholder="15000"
                    type="number"
                    value={flAltMax}
                    onChange={(e) => setFlAltMax(e.target.value)}
                  />
                  <label>Status</label>
                  <select
                    value={flOnGround}
                    onChange={(e) => setFlOnGround(e.target.value as "all" | "airborne" | "ground")}
                  >
                    <option value="all">All</option>
                    <option value="airborne">Airborne</option>
                    <option value="ground">Ground</option>
                  </select>
                </div>

                <div className="ex-row" style={{ marginBottom: "1rem" }}>
                  <button className="primary" onClick={fetchFlights} disabled={flLoading}>
                    {flLoading ? "Fetching..." : "Fetch Flights"}
                  </button>
                  <span style={{ fontSize: "0.72rem", color: "#444" }}>Via /api/flights &middot; 15s cache</span>
                </div>

                {flError && (
                  <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)" }}>
                    <span className="ex-badge err">Error</span> {flError}
                  </div>
                )}

                {flData && (
                  <div>
                    <div className="ex-info-bar">
                      <span>
                        <span className="num">{flData.states.length}</span> flights
                      </span>
                      {flData.states.length !== flData.totalRaw && (
                        <>
                          <span className="ex-sep" />
                          <span style={{ color: "#555" }}>filtered from {flData.totalRaw}</span>
                        </>
                      )}
                      <span className="ex-sep" />
                      <span style={{ color: "#444" }}>Time: {new Date(flData.time * 1000).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ overflow: "auto", maxHeight: 500, borderRadius: 8, border: "1px solid #1a1a1a" }}>
                      <table className="ex-flight-table">
                        <thead>
                          <tr>
                            <th>Callsign</th>
                            <th>Country</th>
                            <th>Lat</th>
                            <th>Lon</th>
                            <th>Alt (m)</th>
                            <th>Speed (m/s)</th>
                            <th>Heading</th>
                            <th>Vert Rate</th>
                            <th>Squawk</th>
                          </tr>
                        </thead>
                        <tbody>
                          {flData.states.slice(0, 200).map((s: FlightState, i: number) => (
                            <tr key={i}>
                              <td style={{ fontWeight: 600, color: "#e0e0e0" }}>{s[1] || "---"}</td>
                              <td>{s[2] || ""}</td>
                              <td>{typeof s[6] === "number" ? s[6].toFixed(4) : "---"}</td>
                              <td>{typeof s[5] === "number" ? s[5].toFixed(4) : "---"}</td>
                              <td>{s[7] != null && typeof s[7] === "number" ? s[7].toFixed(0) : "---"}</td>
                              <td>{s[9] != null && typeof s[9] === "number" ? s[9].toFixed(0) : "---"}</td>
                              <td>{s[10] != null && typeof s[10] === "number" ? s[10].toFixed(0) : "---"}</td>
                              <td
                                style={{
                                  color:
                                    typeof s[11] === "number"
                                      ? s[11] > 0
                                        ? "#22c55e"
                                        : s[11] < 0
                                          ? "#ef4444"
                                          : "#666"
                                      : "#666",
                                }}
                              >
                                {s[11] != null && typeof s[11] === "number"
                                  ? (s[11] > 0 ? "+" : "") + s[11].toFixed(0)
                                  : "---"}
                              </td>
                              <td>{s[14] || ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {flData.states.length > 200 && (
                      <div className="ex-empty" style={{ padding: "0.75rem" }}>
                        ...and {(flData.states.length - 200).toLocaleString()} more flights
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ═══ EARTHQUAKES TAB ═══ */}
            {tab === "earthquakes" && (
              <>
                <h2>USGS Earthquake Feed</h2>
                <p style={{ fontSize: "0.8rem", color: "#555", margin: "0 0 1rem" }}>
                  Real-time earthquake data from USGS. Filter by minimum magnitude and time period.
                </p>

                <div className="ex-filter-group">
                  <label>Min Magnitude</label>
                  <select value={eqMinMag} onChange={(e) => setEqMinMag(e.target.value)}>
                    <option value="0">All</option>
                    <option value="1">M1.0+</option>
                    <option value="2.5">M2.5+</option>
                    <option value="4.5">M4.5+</option>
                    <option value="5">M5.0+</option>
                    <option value="6">M6.0+</option>
                  </select>
                  <label>Period</label>
                  <select value={eqPeriod} onChange={(e) => setEqPeriod(e.target.value)}>
                    <option value="hour">Past Hour</option>
                    <option value="day">Past Day</option>
                    <option value="week">Past Week</option>
                    <option value="month">Past Month</option>
                  </select>
                  <button className="primary" onClick={fetchEarthquakes} disabled={eqLoading}>
                    {eqLoading ? "Fetching..." : "Fetch"}
                  </button>
                </div>

                {eqError && (
                  <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
                    <span className="ex-badge err">Error</span> {eqError}
                  </div>
                )}

                {eqData?.features && (
                  <div>
                    <div className="ex-info-bar">
                      <span>
                        <span className="num">{eqData.features.length}</span> earthquakes
                      </span>
                      <span className="ex-sep" />
                      <span style={{ color: "#444" }}>
                        Generated:{" "}
                        {eqData.metadata?.generated ? new Date(eqData.metadata.generated).toLocaleString() : "N/A"}
                      </span>
                    </div>
                    <div className="ex-quake-list">
                      {eqData.features.map((f: GeoFeature, i: number) => {
                        const p = f.properties;
                        const mag = p.mag;
                        return (
                          <div key={i} className="ex-quake-item">
                            {mag != null && (
                              <div className="ex-quake-mag" style={{ color: magColor(mag), background: magBg(mag) }}>
                                {mag.toFixed(1)}
                              </div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{ fontSize: "0.82rem", fontWeight: 500, color: "#ccc", marginBottom: "0.1rem" }}
                              >
                                {p.place}
                              </div>
                              <div className="ex-row" style={{ fontSize: "0.72rem", color: "#666" }}>
                                <span>
                                  {p.coordinates?.[1]?.toFixed(3)}, {p.coordinates?.[0]?.toFixed(3)}
                                </span>
                                <span className="ex-sep" />
                                <span>Depth: {typeof p.depth === "number" ? p.depth.toFixed(1) : p.depth} km</span>
                                <span className="ex-sep" />
                                <span>{p.tsunami ? "\uD83C\uDF0A Tsunami" : ""}</span>
                              </div>
                            </div>
                            <div
                              style={{ fontSize: "0.7rem", color: "#444", textAlign: "right", whiteSpace: "nowrap" }}
                            >
                              <div>{p.time != null ? new Date(p.time).toLocaleString() : ""}</div>
                              <div style={{ color: "#555" }}>
                                {p.type} &middot; {p.cd ? `felt ${p.cd}` : ""}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ═══ SATELLITES TAB ═══ */}
            {tab === "satellites" && (
              <>
                <h2>Celestrak Satellite Tracker</h2>
                <p style={{ fontSize: "0.8rem", color: "#555", margin: "0 0 1rem" }}>
                  TLE (Two-Line Element) data for active satellites from Celestrak. Search by name or filter by group.
                </p>

                <div className="ex-filter-group">
                  <label>Group</label>
                  <select value={satGroup} onChange={(e) => setSatGroup(e.target.value)} style={{ width: 160 }}>
                    {SATELLITE_GROUPS.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                  <label>Search</label>
                  <input
                    placeholder="STARLINK, ISS, NOAA..."
                    value={satSearch}
                    onChange={(e) => setSatSearch(e.target.value)}
                    style={{ width: 200 }}
                  />
                  <button className="primary" onClick={fetchSatellites} disabled={satLoading}>
                    {satLoading ? "Fetching..." : "Fetch"}
                  </button>
                </div>

                {satError && (
                  <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
                    <span className="ex-badge err">Error</span> {satError}
                  </div>
                )}

                {satData && Array.isArray(satData) && (
                  <div>
                    <div className="ex-info-bar">
                      <span>
                        <span className="num">{satData.length}</span> satellites
                      </span>
                      <span className="ex-sep" />
                      <span style={{ color: "#444" }}>
                        Group: {SATELLITE_GROUPS.find((g) => g.id === satGroup)?.label}
                      </span>
                      {satSearch && (
                        <>
                          <span className="ex-sep" />
                          <span style={{ color: "#555" }}>Filtered: &quot;{satSearch}&quot;</span>
                        </>
                      )}
                    </div>
                    <div style={{ overflow: "auto", maxHeight: 500, borderRadius: 8, border: "1px solid #1a1a1a" }}>
                      <table className="ex-flight-table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>NORAD ID</th>
                            <th>Object Type</th>
                            <th>TLE Line 1</th>
                          </tr>
                        </thead>
                        <tbody>
                          {satData
                            .filter(
                              (s: SatelliteRecord) =>
                                !satSearch || (s.OBJECT_NAME || "").toUpperCase().includes(satSearch.toUpperCase()),
                            )
                            .slice(0, 200)
                            .map((s: SatelliteRecord, i: number) => (
                              <tr key={i}>
                                <td style={{ fontWeight: 600, color: "#e0e0e0" }}>{s.OBJECT_NAME}</td>
                                <td>{s.NORAD_CAT_ID}</td>
                                <td>
                                  <span className="ex-tag">{s.OBJECT_TYPE}</span>
                                </td>
                                <td style={{ fontSize: "0.68rem", color: "#555" }}>{s.TLE_LINE1}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    {satData.length > 200 && (
                      <div className="ex-empty" style={{ padding: "0.75rem" }}>
                        ...and {(satData.length - 200).toLocaleString()} more satellites
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ═══ MARINE TAB ═══ */}
            {tab === "marine" && (
              <>
                <h2>Marine Weather (Open-Meteo)</h2>
                <p style={{ fontSize: "0.8rem", color: "#555", margin: "0 0 1rem" }}>
                  Wave height, direction, period, wind speed, and temperature from Open-Meteo Marine API.
                </p>

                <div className="ex-filter-group">
                  <label>Latitude</label>
                  <input
                    placeholder="40.7128"
                    value={marLat}
                    onChange={(e) => setMarLat(e.target.value)}
                    style={{ width: 120 }}
                  />
                  <label>Longitude</label>
                  <input
                    placeholder="-74.006"
                    value={marLon}
                    onChange={(e) => setMarLon(e.target.value)}
                    style={{ width: 120 }}
                  />
                  <button className="primary" onClick={fetchMarine} disabled={marLoading}>
                    {marLoading ? "Fetching..." : "Fetch"}
                  </button>
                </div>

                {marError && (
                  <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
                    <span className="ex-badge err">Error</span> {marError}
                  </div>
                )}

                {marData?.current && (
                  <div style={{ marginTop: "1rem" }}>
                    <h3>
                      Current Conditions at {marLat}, {marLon}
                    </h3>
                    <div style={{ fontSize: "0.72rem", color: "#555", marginBottom: "0.75rem" }}>
                      Time: {marData.current.time ? new Date(marData.current.time).toLocaleString() : "N/A"}
                    </div>
                    <div className="ex-grid">
                      {[
                        {
                          label: "Wave Height",
                          value: `${marData.current.wave_height ?? "---"} m`,
                          icon: "\uD83C\uDF0A",
                        },
                        {
                          label: "Wave Direction",
                          value: `${marData.current.wave_direction ?? "---"}\u00B0`,
                          icon: "\uD83E\uDDF3",
                        },
                        {
                          label: "Wave Period",
                          value: `${marData.current.wave_period ?? "---"} s`,
                          icon: "\u23F1\uFE0F",
                        },
                        {
                          label: "Wind Wave Height",
                          value: `${marData.current.wind_wave_height ?? "---"} m`,
                          icon: "\uD83C\uDF2A\uFE0F",
                        },
                        {
                          label: "Swell Height",
                          value: `${marData.current.swell_wave_height ?? "---"} m`,
                          icon: "\uD83C\uDF0A",
                        },
                        {
                          label: "Swell Direction",
                          value: `${marData.current.swell_wave_direction ?? "---"}\u00B0`,
                          icon: "\uD83E\uDDF3",
                        },
                        {
                          label: "Swell Period",
                          value: `${marData.current.swell_wave_period ?? "---"} s`,
                          icon: "\u23F1\uFE0F",
                        },
                        {
                          label: "Wind Speed",
                          value: `${marData.current.wind_speed_10m ?? "---"} km/h`,
                          icon: "\uD83C\uDF2C\uFE0F",
                        },
                        {
                          label: "Wind Direction",
                          value: `${marData.current.wind_direction_10m ?? "---"}\u00B0`,
                          icon: "\uD83E\uDDF3",
                        },
                        {
                          label: "Wind Gusts",
                          value: `${marData.current.wind_gusts_10m ?? "---"} km/h`,
                          icon: "\uD83C\uDF2A\uFE0F",
                        },
                        {
                          label: "Temperature",
                          value: `${marData.current.temperature_2m ?? "---"}\u00B0C`,
                          icon: "\uD83C\uDF21\uFE0F",
                        },
                      ].map((item) => (
                        <div key={item.label} className="ex-card" style={{ textAlign: "center" }}>
                          <div style={{ fontSize: "1.3rem", marginBottom: "0.25rem" }}>{item.icon}</div>
                          <div
                            style={{
                              fontSize: "1.2rem",
                              fontWeight: 700,
                              color: "#4a9eff",
                              fontFamily: "'JetBrains Mono',monospace",
                              marginBottom: "0.15rem",
                            }}
                          >
                            {item.value}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "#666" }}>{item.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ═══ OVERPASS TAB ═══ */}
            {tab === "overpass" && (
              <>
                <h2>Overpass API / OpenStreetMap</h2>
                <p style={{ fontSize: "0.8rem", color: "#555", margin: "0 0 1rem" }}>
                  Query OpenStreetMap data using the Overpass QL language. Use{" "}
                  <code
                    style={{
                      color: "#4a9eff",
                      background: "rgba(74,158,255,0.1)",
                      padding: "0.1rem 0.3rem",
                      borderRadius: 3,
                    }}
                  >
                    &#123;&#123;bbox&#125;&#125;
                  </code>{" "}
                  as a placeholder for the bounding box.
                </p>

                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ fontSize: "0.78rem", color: "#666", display: "block", marginBottom: "0.25rem" }}>
                    Bounding Box (west,south,east,north)
                  </label>
                  <input
                    value={opBbox}
                    onChange={(e) => setOpBbox(e.target.value)}
                    placeholder="-74.02,40.70,-73.95,40.78"
                  />
                </div>

                <div style={{ marginBottom: "0.5rem" }}>
                  <label style={{ fontSize: "0.78rem", color: "#666", display: "block", marginBottom: "0.25rem" }}>
                    Overpass QL Query
                  </label>
                  <textarea
                    value={opQuery}
                    onChange={(e) => setOpQuery(e.target.value)}
                    rows={6}
                    placeholder={`[out:json][timeout:25];\nnode["amenity"]({{bbox}});\nout;`}
                    style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: "0.82rem", resize: "vertical" }}
                  />
                </div>

                <div className="ex-row" style={{ marginBottom: "1rem" }}>
                  <button className="primary" onClick={runOverpass} disabled={opLoading}>
                    {opLoading ? "Running..." : "Run Query"}
                  </button>
                  <span style={{ fontSize: "0.72rem", color: "#444" }}>Via /api/overpass</span>
                </div>

                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.5rem" }}>Quick Queries</div>
                  <div className="ex-query-grid">
                    {OVERPASS_QUERIES.map((q, i) => (
                      <button key={i} className="ex-query-btn" onClick={() => setOpQuery(q.query)}>
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>

                {opError && (
                  <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginBottom: "1rem" }}>
                    <span className="ex-badge err">Error</span> {opError}
                  </div>
                )}

                {opResult && (
                  <div>
                    <h3>Results</h3>
                    <div className="ex-stat">
                      <span className="num">{opStats.nodes.toLocaleString()}</span> nodes
                      <span className="ex-sep" />
                      <span className="num">{opStats.ways.toLocaleString()}</span> ways
                      <span className="ex-sep" />
                      <span className="num">{opStats.relations.toLocaleString()}</span> relations
                      <span className="ex-sep" />
                      <span style={{ color: "#444" }}>Snapshot: {opResult.osm3s?.timestamp_osm_base || "N/A"}</span>
                    </div>
                    {opResult.elements.length > 0 && (
                      <pre style={{ marginTop: "0.75rem" }}>
                        {JSON.stringify(opResult.elements.slice(0, 50), null, 2)}
                        {opResult.elements.length > 50 &&
                          `\n... and ${(opResult.elements.length - 50).toLocaleString()} more elements`}
                      </pre>
                    )}
                    {opResult.elements.length === 0 && (
                      <div className="ex-empty">No elements found for this query and bounding box.</div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ═══ OVERTURE MAPS TAB ═══ */}
            {tab === "overture" && (
              <>
                <h2>Overture Maps</h2>
                <p style={{ fontSize: "0.8rem", color: "#555", margin: "0 0 1rem" }}>
                  Open map data from the Overture Maps Foundation. Select a theme and type, then enter a bounding box to
                  query features.
                </p>

                <div className="ex-ds-grid" style={{ marginBottom: "1rem" }}>
                  {OVERTURE_THEMES.map((theme) => (
                    <div
                      key={theme.id}
                      className={`ex-ds-card ${ovTheme === theme.id ? "selected" : ""}`}
                      onClick={() => {
                        setOvTheme(theme.id);
                        setOvType(theme.types[0]);
                        setOvData(null);
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.2rem" }}>{theme.label}</div>
                      <div style={{ fontSize: "0.78rem", color: "#666", lineHeight: 1.45 }}>{theme.desc}</div>
                      <div className="ex-row" style={{ marginTop: "0.5rem", gap: "0.3rem" }}>
                        {theme.types.map((t) => (
                          <span key={t} className="ex-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="ex-toolbar">
                  <label style={{ fontSize: "0.75rem", color: "#666", whiteSpace: "nowrap" }}>Type</label>
                  <select
                    value={ovType}
                    onChange={(e) => setOvType(e.target.value)}
                    style={{ width: "auto", minWidth: 120 }}
                  >
                    {selectedOvertureTheme?.types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="west,south,east,north (e.g. -74.02,40.70,-73.95,40.78)"
                    value={ovBbox}
                    onChange={(e) => setOvBbox(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && fetchOverture()}
                  />
                  <button className="primary" onClick={fetchOverture} disabled={ovLoading}>
                    {ovLoading ? "Fetching..." : "Query"}
                  </button>
                </div>

                <div className="ex-info-bar">
                  <span style={{ fontSize: "0.72rem", color: "#444" }}>
                    API: api.overturemaps.org/v0/{ovTheme}/{ovType}
                  </span>
                </div>

                {ovError && (
                  <div className="ex-card" style={{ borderColor: "rgba(239,68,68,0.3)", marginTop: "1rem" }}>
                    <span className="ex-badge err">Error</span> {ovError}
                  </div>
                )}

                {ovData && (
                  <div style={{ marginTop: "1rem" }}>
                    <h3>
                      Results: {ovTheme}/{ovType}
                    </h3>
                    <div className="ex-stat">
                      <span className="num">{ovData.features?.length || 0}</span> features
                    </div>
                    {ovData.features?.length > 0 && (
                      <pre style={{ maxHeight: 500, marginTop: "0.5rem" }}>
                        {JSON.stringify(ovData.features.slice(0, 20), null, 2)}
                      </pre>
                    )}
                    {ovData.features?.length > 20 && (
                      <div className="ex-empty" style={{ padding: "0.75rem" }}>
                        ...and {(ovData.features.length - 20).toLocaleString()} more features
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
