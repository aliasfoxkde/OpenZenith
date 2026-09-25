"use client";

import { useState, useCallback, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { ErrorBoundary } from "@/components/ErrorBoundary";


import {
  FlightResponse,
  FlightState,
  MarineResponse,
  NoaaData,
  OverpassElement,
  OverpassResult,
  OvertureResponse,
  SatelliteRecord,
  TABS,
  NOAA_DATASETS,
  TabId,
  proxyFetch,
} from "./data";

import { NoaaTab } from "./tabs/NoaaTab";
import { FlightsTab } from "./tabs/FlightsTab";
import { EarthquakesTab } from "./tabs/EarthquakesTab";
import { SatellitesTab } from "./tabs/SatellitesTab";
import { MarineTab } from "./tabs/MarineTab";
import { OverpassTab } from "./tabs/OverpassTab";
import { OvertureTab } from "./tabs/OvertureTab";

/* ═══════════════════════════════════════════════════════════════
   CSS
   ═══════════════════════════════════════════════════════════════ */

const S = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
.ex-wrap{position:relative;width:100vw;min-height:100vh;overflow-x:hidden;font-family:system-ui,-apple-system,sans-serif;color:#e0e0e0;background:#0a0e17}
.ex-body{padding:1.5rem 2rem 3rem;max-width:1600px;margin:0 auto}
.ex-body h1{font-size:1.5rem;font-weight:700;margin:0 0 0.25rem;letter-spacing:-0.02em}
/* This surface is permanently dark (#0a0e17) in both themes, so every text
   color below is light-on-dark and measured against the blended card/tint
   surface it lands on. */
.ex-body .sub{color:#a3a3a3;font-size:0.85rem;margin:0 0 1.5rem} /* 7.65:1 on #0a0e17 */
.ex-body h2{font-size:1.05rem;font-weight:600;margin:1.5rem 0 0.75rem;padding-bottom:0.5rem;border-bottom:1px solid rgba(255,255,255,0.06)}
.ex-body h3{font-size:0.9rem;font-weight:600;margin:1rem 0 0.5rem}
.ex-body a{color:#7cb8ff;text-decoration:none} /* 9.33:1 on #0a0e17 */
.ex-body a:hover{text-decoration:underline}
.ex-body input,.ex-body textarea,.ex-body select{background:#0d1117;color:#e0e0e0;border:1px solid #222;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.85rem;font-family:inherit;outline:none;width:100%;box-sizing:border-box;transition:border-color .15s}
.ex-body input:focus,.ex-body textarea:focus{border-color:#7cb8ff}
.ex-body button{padding:0.45rem 1rem;border-radius:6px;border:none;font-size:0.85rem;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s}
.ex-body button:hover{opacity:0.85}
.ex-body button:disabled{opacity:0.4;cursor:not-allowed}
.ex-body button.primary{background:#4a9eff;color:#000}
.ex-body button.secondary{background:rgba(255,255,255,0.04);color:#cccccc;border:1px solid #222} /* 11.1:1 on #141820 */
.ex-body button.danger{background:#7f1d1d;color:#ffffff} /* 10.0:1 (was #ef4444 = 3.8:1) */
.ex-body pre{background:#0d1117;border:1px solid #1a1a1a;border-radius:8px;padding:0.75rem 1rem;font-size:0.78rem;line-height:1.6;overflow:auto;max-height:500px;color:#a3a3a3;font-family:'JetBrains Mono',monospace} /* 7.7:1 on #0d1117 */
.ex-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:0.75rem}
.ex-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:1rem;transition:border-color .15s}
.ex-card:hover{border-color:rgba(255,255,255,0.12)}
.ex-badge{display:inline-block;padding:0.1rem 0.5rem;border-radius:4px;font-size:0.7rem;font-weight:500}
.ex-badge.fs{background:rgba(74,158,255,0.12);color:#7cb8ff} /* 7.57:1 on #162437 */
.ex-badge.ms{background:rgba(168,85,247,0.12);color:#d8b4fe} /* 9.32:1 on #211b36 */
.ex-badge.ts{background:rgba(34,197,94,0.12);color:#34d399} /* 8.07:1 on #112824 */
.ex-badge.is{background:rgba(251,146,60,0.12);color:#fdba74} /* 9.21:1 on #2b2220 */
.ex-badge.wms{background:rgba(234,179,8,0.12);color:#fde047} /* 11.49:1 on #29261a */
.ex-badge.err{background:rgba(239,68,68,0.12);color:#fca5a5} /* 8.79:1 on #2a1921 */
.ex-badge.noaa{background:rgba(56,189,248,0.12);color:#5ecbff} /* 8.35:1 on #142736 */
.ex-badge.usgs{background:rgba(239,68,68,0.12);color:#fca5a5} /* 8.79:1 on #2a1921 */
.ex-badge.nasa{background:rgba(34,197,94,0.12);color:#34d399} /* 8.07:1 on #112824 */
.ex-badge.flight{background:rgba(251,146,60,0.12);color:#fdba74} /* 9.21:1 on #2b2220 */
.ex-badge.sat{background:rgba(6,182,212,0.12);color:#67e8f9} /* 10.69:1 on #0e2732 */
.ex-badge.marine{background:rgba(59,130,246,0.12);color:#93c5fd} /* 9.03:1 on #142036 */
.ex-stat{display:flex;align-items:center;gap:0.5rem;margin:0.25rem 0;font-size:0.8rem}
.ex-stat .num{color:#7cb8ff;font-weight:600;font-family:'JetBrains Mono',monospace} /* 7.37:1 on #0f131c */
.ex-row{display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap}
.ex-tag{font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;background:rgba(255,255,255,0.03);color:#a3a3a3;border:1px solid #1a1a1a} /* 7.5:1 on #10131b */
.ex-sep{width:1px;height:16px;background:#1a1a1a;margin:0 0.25rem}
.ex-empty{text-align:center;padding:2rem;color:#a3a3a3;font-size:0.85rem}
.ex-query-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.5rem;margin-bottom:1rem}
.ex-query-btn{padding:0.4rem 0.6rem;font-size:0.78rem;background:rgba(255,255,255,0.02);color:#a3a3a3;border:1px solid #1a1a1a;border-radius:6px;cursor:pointer;text-align:left;transition:all .15s;font-family:inherit}
.ex-query-btn:hover{border-color:#7cb8ff;color:#7cb8ff;background:rgba(74,158,255,0.05)}
.ex-tabs{display:flex;gap:0.25rem;margin-bottom:1.25rem;background:rgba(255,255,255,0.02);border-radius:8px;padding:3px;border:1px solid rgba(255,255,255,0.06);flex-wrap:wrap}
.ex-tab{padding:0.4rem 0.8rem;border-radius:6px;border:none;font-size:0.78rem;font-weight:500;cursor:pointer;font-family:inherit;transition:all .15s;background:transparent;color:#a3a3a3;white-space:nowrap} /* 7.6:1 on #0e121a */
.ex-tab:hover{color:#a3a3a3}
.ex-tab.active{background:rgba(74,158,255,0.12);color:#7cb8ff} /* 7.57:1 on #162437 */
.ex-toolbar{display:flex;gap:0.5rem;align-items:center;margin-bottom:1rem;padding:0.75rem 1rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;flex-wrap:wrap}
.ex-toolbar input{flex:1;min-width:120px}
.ex-info-bar{display:flex;gap:1rem;align-items:center;padding:0.5rem 0;margin-bottom:1rem;font-size:0.8rem;color:#a3a3a3;border-bottom:1px solid rgba(255,255,255,0.04);padding-bottom:0.75rem;flex-wrap:wrap}
.ex-ds-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0.75rem}
.ex-ds-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:1rem;cursor:pointer;transition:all .15s}
.ex-ds-card:hover{border-color:rgba(74,158,255,0.3);background:rgba(74,158,255,0.03)}
.ex-ds-card.selected{border-color:rgba(74,158,255,0.5);background:rgba(74,158,255,0.06)}
.ex-flight-table{width:100%;border-collapse:collapse;font-size:0.78rem}
.ex-flight-table th{text-align:left;padding:0.4rem 0.6rem;color:#a3a3a3;font-weight:500;border-bottom:1px solid #1a1a1a;position:sticky;top:0;background:#0a0e17} /* 7.65:1 */
.ex-flight-table td{padding:0.35rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.03);color:#c9c9c9;font-family:'JetBrains Mono',monospace} /* 11.2:1 on #0f131c */
.ex-flight-table tr:hover td{background:rgba(74,158,255,0.04)}
.ex-quake-list{display:flex;flex-direction:column;gap:0.4rem}
.ex-quake-item{display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;transition:border-color .15s}
.ex-quake-item:hover{border-color:rgba(239,68,68,0.3)}
.ex-quake-mag{width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;flex-shrink:0;font-family:'JetBrains Mono',monospace}
.ex-filter-group{display:flex;gap:0.5rem;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap}
.ex-filter-group label{font-size:0.75rem;color:#a3a3a3;white-space:nowrap}
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
   Component
   ═══════════════════════════════════════════════════════════════ */


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
      const ds = NOAA_DATASETS.at(i);
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
                setNoaaData(gpResp);
              }
            } else {
              setNoaaData(gpResp);
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


  // Tab configs
  // Keyboard shortcuts: number keys switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= TABS.length) {
        setTab(TABS[num - 1].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, []);

  return (
    <ErrorBoundary>
      <div className="ex-wrap">
        <style dangerouslySetInnerHTML={{ __html: S }} />

        {/* Nav */}
        <Navbar dark breadcrumb="Explore" />

        <main className="ex-body">
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
                onClick={() => { setTab(t.id); }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" aria-label="Explore data panel">
            {/* ═══ NOAA & USGS TAB ═══ */}
            {tab === "noaa" && (
              <NoaaTab
                selected={noaaSelected}
                data={noaaData}
                error={noaaError}
                loading={noaaLoading}
                nwsLat={nwsLat}
                nwsLon={nwsLon}
                onSelectDataset={(i) => {
                  setNoaaSelected(i);
                  setNoaaData(null);
                  setNoaaError("");
                }}
                onNwsLatChange={setNwsLat}
                onNwsLonChange={setNwsLon}
                onFetch={() => {
                  void fetchNoaa();
                }}
              />
            )}

            {/* ═══ FLIGHTS TAB ═══ */}
            {tab === "flights" && (
              <FlightsTab
                data={flData}
                error={flError}
                loading={flLoading}
                bbox={flBbox}
                callsign={flCallsign}
                altMin={flAltMin}
                altMax={flAltMax}
                onGround={flOnGround}
                onBboxChange={setFlBbox}
                onCallsignChange={setFlCallsign}
                onAltMinChange={setFlAltMin}
                onAltMaxChange={setFlAltMax}
                onStatusChange={setFlOnGround}
                onFetch={() => {
                  void fetchFlights();
                }}
              />
            )}

            {/* ═══ EARTHQUAKES TAB ═══ */}
            {tab === "earthquakes" && (
              <EarthquakesTab
                data={eqData}
                error={eqError}
                loading={eqLoading}
                minMag={eqMinMag}
                period={eqPeriod}
                onMinMagChange={setEqMinMag}
                onPeriodChange={setEqPeriod}
                onFetch={() => {
                  void fetchEarthquakes();
                }}
              />
            )}

            {/* ═══ SATELLITES TAB ═══ */}
            {tab === "satellites" && (
              <SatellitesTab
                data={satData}
                error={satError}
                loading={satLoading}
                group={satGroup}
                search={satSearch}
                onGroupChange={setSatGroup}
                onSearchChange={setSatSearch}
                onFetch={() => {
                  void fetchSatellites();
                }}
              />
            )}

            {/* ═══ MARINE TAB ═══ */}
            {tab === "marine" && (
              <MarineTab
                data={marData}
                error={marError}
                loading={marLoading}
                lat={marLat}
                lon={marLon}
                onLatChange={setMarLat}
                onLonChange={setMarLon}
                onFetch={() => {
                  void fetchMarine();
                }}
              />
            )}

            {/* ═══ OVERPASS TAB ═══ */}
            {tab === "overpass" && (
              <OverpassTab
                query={opQuery}
                bbox={opBbox}
                result={opResult}
                error={opError}
                loading={opLoading}
                stats={opStats}
                onQueryChange={setOpQuery}
                onBboxChange={setOpBbox}
                onRun={() => {
                  void runOverpass();
                }}
              />
            )}

            {/* ═══ OVERTURE MAPS TAB ═══ */}
            {tab === "overture" && (
              <OvertureTab
                theme={ovTheme}
                type={ovType}
                bbox={ovBbox}
                data={ovData}
                error={ovError}
                loading={ovLoading}
                onSelectTheme={(id, firstType) => {
                  setOvTheme(id);
                  setOvType(firstType);
                  setOvData(null);
                }}
                onTypeChange={setOvType}
                onBboxChange={setOvBbox}
                onFetch={() => {
                  void fetchOverture();
                }}
              />
            )}
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}
