"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { LAYERS, CATEGORY_ORDER, CATEGORY_LABELS } from "@/lib/layers/registry";
import { Navbar } from "@/components/Navbar";

/* ─── Registry lookup ─── */
const LAYER_MAP = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

/* ─── Sidebar section mapping ─── */
const SIDEBAR_SECTIONS: { title: string; key: string; layerIds: (keyof LayerState)[] }[] = [
  {
    title: "Overlays",
    key: "overlays",
    layerIds: ["hillshade", "elevationColor", "satellite", "blueMarble", "nightLights"],
  },
  {
    title: "Real-Time Data",
    key: "realtime",
    layerIds: ["earthquakes", "radar", "flights", "militaryFlights", "vessels", "warnings", "events", "satellites", "hurricaneTracks"],
  },
  {
    title: "Infrastructure",
    key: "infrastructure",
    layerIds: ["nlnogNodes", "flightArcs"],
  },
];

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface LayerState {
  earthquakes: boolean;
  radar: boolean;
  satellite: boolean;
  flights: boolean;
  militaryFlights: boolean;
  vessels: boolean;
  warnings: boolean;
  events: boolean;
  satellites: boolean;
  hillshade: boolean;
  elevationColor: boolean;
  hurricaneTracks: boolean;
  blueMarble: boolean;
  nightLights: boolean;
  nlnogNodes: boolean;
  flightArcs: boolean;
}

interface DashboardState {
  center: [number, number];
  zoom: number;
  basemap: string;
  layers: LayerState;
  theme: string;
  viewMode: "3d" | "2d" | "columbus";
}

interface DataStatus {
  key: string;
  label: string;
  lastUpdate: number | null;
  count: number;
  error: string | null;
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const BASEMAPS: Record<string, { label: string; url: string }> = {
  dark: { label: "Dark", url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png" },
  satellite: { label: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" },
  osm: { label: "OSM", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" },
  voyager: { label: "Voyager", url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png" },
  topo: { label: "Topo", url: "https://tile.opentopomap.org/{z}/{x}/{y}.png" },
};

const DEFAULT_LAYERS: LayerState = {
  earthquakes: true,
  radar: false,
  satellite: false,
  flights: false,
  militaryFlights: false,
  vessels: false,
  warnings: false,
  events: true,
  satellites: false,
  hillshade: true,
  elevationColor: false,
  hurricaneTracks: false,
  blueMarble: false,
  nightLights: false,
  nlnogNodes: false,
  flightArcs: false,
};

const DEFAULT_STATE: DashboardState = {
  center: [0, 20],
  zoom: 2,
  basemap: "dark",
  layers: { ...DEFAULT_LAYERS },
  theme: "default",
  viewMode: "3d",
};

const THEMES: Record<string, { label: string; icon: string; css: string }> = {
  default: {
    label: "Default",
    icon: "◇",
    css: `--bg:rgba(10,14,23,0.95);--bg-solid:#0a0e17;--bg-nav:rgba(10,14,23,0.92);--bg-hover:rgba(255,255,255,0.03);--border:rgba(255,255,255,0.08);--border-hover:rgba(255,255,255,0.15);--text:#e0e0e0;--text-dim:#aab;--text-muted:#666;--text-muted2:#555;--text-darker:#444;--accent:#4a9eff;--accent-glow:rgba(74,158,255,0.2);--accent-active:#4a9eff;--brand:#22c55e;--ok:#22c55e;--err:#ef4444;--warn:#eab308;--font-ui:system-ui,-apple-system,sans-serif;--font-mono:'JetBrains Mono',monospace;--scanlines:none;--corner-size:0;--ticker-display:none;--classification-display:none;--grid-display:none;--glow-intensity:0`,
  },
  classified: {
    label: "Classified Intel",
    icon: "▲",
    css: `--bg:rgba(0,8,4,0.96);--bg-solid:#000a04;--bg-nav:rgba(0,8,4,0.94);--bg-hover:rgba(0,255,65,0.05);--border:rgba(0,255,65,0.15);--border-hover:rgba(0,255,65,0.35);--text:#00ff41;--text-dim:#00cc33;--text-muted:#008822;--text-muted2:#006618;--text-darker:#004410;--accent:#00ff41;--accent-glow:rgba(0,255,65,0.15);--accent-active:#00ff41;--brand:#00ff41;--ok:#00ff41;--err:#ff0040;--warn:#ffaa00;--font-ui:'JetBrains Mono',monospace;--font-mono:'JetBrains Mono',monospace;--scanlines:block;--corner-size:16px;--ticker-display:block;--classification-display:block;--grid-display:block;--glow-intensity:1`,
  },
  amber: {
    label: "Amber Terminal",
    icon: "◉",
    css: `--bg:rgba(12,8,0,0.96);--bg-solid:#0c0800;--bg-nav:rgba(12,8,0,0.94);--bg-hover:rgba(255,176,0,0.05);--border:rgba(255,176,0,0.15);--border-hover:rgba(255,176,0,0.35);--text:#ffb000;--text-dim:#cc8d00;--text-muted:#885e00;--text-muted2:#664600;--text-darker:#443000;--accent:#ffb000;--accent-glow:rgba(255,176,0,0.15);--accent-active:#ffb000;--brand:#ffb000;--ok:#00ff41;--err:#ff3333;--warn:#ffaa00;--font-ui:'JetBrains Mono',monospace;--font-mono:'JetBrains Mono',monospace;--scanlines:block;--corner-size:8px;--ticker-display:block;--classification-display:none;--grid-display:none;--glow-intensity:0.6`,
  },
  arctic: {
    label: "Arctic",
    icon: "❄",
    css: `--bg:rgba(8,16,28,0.95);--bg-solid:#08101c;--bg-nav:rgba(8,16,28,0.92);--bg-hover:rgba(100,200,255,0.05);--border:rgba(100,200,255,0.12);--border-hover:rgba(100,200,255,0.3);--text:#c8e6ff;--text-dim:#88bbee;--text-muted:#4477aa;--text-muted2:#335577;--text-darker:#223344;--accent:#00ccff;--accent-glow:rgba(0,204,255,0.15);--accent-active:#00ccff;--brand:#66ddff;--ok:#00ff88;--err:#ff4466;--warn:#ffcc00;--font-ui:system-ui,-apple-system,sans-serif;--font-mono:'JetBrains Mono',monospace;--scanlines:none;--corner-size:0;--ticker-display:none;--classification-display:none;--grid-display:none;--glow-intensity:0`,
  },
  crimson: {
    label: "Crimson Ops",
    icon: "⬥",
    css: `--bg:rgba(16,4,4,0.96);--bg-solid:#100404;--bg-nav:rgba(16,4,4,0.94);--bg-hover:rgba(255,40,40,0.05);--border:rgba(255,40,40,0.15);--border-hover:rgba(255,40,40,0.35);--text:#ff4444;--text-dim:#cc3333;--text-muted:#882222;--text-muted2:#661818;--text-darker:#441010;--accent:#ff2222;--accent-glow:rgba(255,34,34,0.15);--accent-active:#ff2222;--brand:#ff4444;--ok:#44ff44;--err:#ff0000;--warn:#ffaa00;--font-ui:'JetBrains Mono',monospace;--font-mono:'JetBrains Mono',monospace;--scanlines:block;--corner-size:12px;--ticker-display:block;--classification-display:block;--grid-display:none;--glow-intensity:0.8`,
  },
};

const EONET_COLORS: Record<string, string> = {
  volcanoes: "#ff4444",
  wildfires: "#ff8800",
  icesbergs: "#44aaff",
  severeStorms: "#ff00ff",
  landslides: "#aa8800",
  seaLakeIce: "#00ccff",
  flood: "#0066ff",
  drought: "#ccaa00",
  manmade: "#888888",
};

// SVG icons for data entities
const ICONS = {
  flight: `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V18l-8 2.5v2l8-2.5V22l8-2.5v-2l-8 2.5V18l8-2.5z" fill="currentColor"/></svg>`,
  vessel: `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.21-1.66-3.5-2.68H7.5C6.22 18.21 5.21 19.53 4 19.68 2.78 20.53 1.39 21 0 21c2 0 2-2 2-2s0-2 2-2c1.39 0 2.78-.47 4-1.32 1.21-.15 2.22-1.47 3.5-2.68h9c1.28 1.21 2.29 2.53 3.5 2.68 1.22.85 2.61 1.32 4 1.32 2 0 2 2 2 2s0 2-2 2zM12 2l4 4h-3l-1 7H12l-1-7H8l4-4z" fill="currentColor"/></svg>`,
  satellite: `<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="none" stroke="currentColor" stroke-width="1"/><path d="M3.51 9h17M3.51 15h17" fill="none" stroke="currentColor" stroke-width="1" transform="rotate(45 12 12)"/></svg>`,
  eq: `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M16 2L8 22M12 2l8 20M2 12h20" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`,
  storm: `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01z" fill="currentColor"/></svg>`,
};

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function waitForCesium(timeout = 20000): Promise<any> {
  return new Promise((res, rej) => {
    const w = window as any;
    if (w.Cesium) return res(w.Cesium);
    const s = Date.now();
    const iv = setInterval(() => {
      if (w.Cesium) { clearInterval(iv); res(w.Cesium); }
      else if (Date.now() - s > timeout) { clearInterval(iv); rej(new Error("CesiumJS failed to load")); }
    }, 100);
  });
}

function parseHash(h: string): Partial<DashboardState> {
  try {
    const p = new URLSearchParams(h.replace(/^#/, ""));
    if (!p.toString()) return {};
    const lng = p.get("lng");
    const lat = p.get("lat");
    let center: [number, number] | undefined;
    if (lng && lat) {
      const ln = Number(lng);
      const lt = Number(lat);
      if (!isNaN(ln) && !isNaN(lt)) center = [ln, lt];
    }
    const zoomVal = p.get("zoom");
    const layers = p.get("l");
    const activeLayers = layers ? layers.split(",") : [];
    const vm = p.get("view");
    return {
      center,
      zoom: zoomVal ? Number(zoomVal) : undefined,
      basemap: p.get("bm") || undefined,
      theme: p.get("theme") || undefined,
      viewMode: vm ? (vm === "2d" ? "2d" : vm === "columbus" ? "columbus" : "3d") : undefined,
      layers: {
        ...DEFAULT_LAYERS,
        ...Object.fromEntries(activeLayers.map((l) => [l, true])),
      },
    };
  } catch { return {}; }
}

function buildHash(s: DashboardState): string {
  const p = new URLSearchParams();
  p.set("lng", s.center[0].toFixed(4));
  p.set("lat", s.center[1].toFixed(4));
  p.set("zoom", s.zoom.toFixed(1));
  if (s.basemap !== "dark") p.set("bm", s.basemap);
  if (s.theme !== "default") p.set("theme", s.theme);
  if (s.viewMode !== "3d") p.set("view", s.viewMode);
  const active = Object.entries(s.layers).filter(([, v]) => v).map(([k]) => k);
  if (active.length) p.set("l", active.join(","));
  return "#" + p.toString();
}

function fmtTime(ts: number | null): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function safeCopy(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  } catch { /* clipboard unavailable */ }
}

function elevationColor(elev: number): string {
  if (elev < 0) return "#1a5276";
  if (elev < 200) return "#1e8449";
  if (elev < 500) return "#27ae60";
  if (elev < 1000) return "#f4d03f";
  if (elev < 2000) return "#e67e22";
  if (elev < 4000) return "#d35400";
  return "#922b21";
}

/* ═══════════════════════════════════════════════════════════════
   Data fetchers
   ═══════════════════════════════════════════════════════════════ */

async function fetchEarthquakes(): Promise<any> {
  const r = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
  return r.json();
}

async function fetchRainViewer(): Promise<any> {
  const r = await fetch("https://api.rainviewer.com/public/weather-maps.json");
  return r.json();
}

async function fetchEONET(): Promise<any> {
  const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200");
  return r.json();
}

async function fetchFlights(): Promise<any> {
  const r = await fetch("/api/flights");
  return r.json();
}

async function fetchMilitaryFlights(): Promise<any> {
  try {
    const r = await fetch("https://adsbexchange.com/api/aircraft/v2/lat/30/lon/-90/dist/500");
    if (!r.ok) return { ac: [] };
    return r.json();
  } catch {
    return { ac: [] };
  }
}

async function fetchVessels(): Promise<any> {
  try {
    const r = await fetch("https://marine-api.open-meteo.com/v1/marine?latitude=40&longitude=-74&current=wave_height");
    return r.json();
  } catch {
    return {};
  }
}

async function fetchWarnings(): Promise<any> {
  const r = await fetch("/api/weather/warnings");
  return r.json();
}

async function fetchCelestrak(): Promise<any> {
  const r = await fetch("https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json");
  return r.json();
}

async function fetchHurricaneTracks(): Promise<any> {
  const r = await fetch(
    "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv"
  );
  return r.text();
}

/* ═══════════════════════════════════════════════════════════════
   CSS
   ═══════════════════════════════════════════════════════════════ */

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');

.wv-wrap{position:relative;width:100vw;height:100vh;overflow:hidden;font-family:var(--font-ui);background:var(--bg-solid);color:var(--text);
  display:flex;flex-direction:column}

.wv-scanlines{display:var(--scanlines);position:absolute;inset:0;z-index:15;pointer-events:none;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px)}

.wv-grid-overlay{display:var(--grid-display);position:absolute;inset:0;z-index:14;pointer-events:none;
  background-image:linear-gradient(rgba(0,255,65,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,65,0.03) 1px,transparent 1px);
  background-size:60px 60px;animation:gridPulse 4s ease-in-out infinite}
@keyframes gridPulse{0%,100%{opacity:1}50%{opacity:0.4}}

.wv-hud-corners{display:block;position:absolute;inset:0;z-index:14;pointer-events:none}
.wv-hud-inner{position:absolute;inset:8px;border:1px solid var(--border);border-radius:var(--corner-size);opacity:0.4}
.wv-hud-inner::before,.wv-hud-inner::after{content:'';position:absolute;width:16px;height:16px;border-color:var(--accent);border-style:solid;opacity:0.5}
.wv-hud-inner::before{top:-1px;left:-1px;border-width:2px 0 0 0}
.wv-hud-inner::after{bottom:-1px;right:-1px;border-width:0 0 2px 2px}

.wv-classification{display:var(--classification-display);position:absolute;top:52px;left:50%;transform:translateX(-50%);z-index:20;
  background:rgba(0,0,0,0.8);border:1px solid var(--border);padding:2px 16px;font-size:10px;font-family:var(--font-mono);letter-spacing:3px;color:var(--text)}

.wv-ticker{display:var(--ticker-display);position:absolute;bottom:28px;left:0;right:0;z-index:20;overflow:hidden;
  background:rgba(0,0,0,0.6);border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:3px 0;font-family:var(--font-mono);font-size:9px;color:var(--text-muted);white-space:nowrap}
.wv-ticker-inner{display:inline-block;animation:ticker 60s linear infinite}
@keyframes ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}

.wv-glow{text-shadow:0 0 8px var(--accent-glow),0 0 16px var(--accent-glow)}
.wv-blink{animation:blink 1.5s step-end infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.wv-pulse{animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}

.wv-loading-overlay{position:absolute;inset:0;z-index:50;background:var(--bg-solid);display:flex;align-items:center;justify-content:center}
.spinner{width:32px;height:32px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── View mode toggle ── */
.wv-view-toggle{display:flex;gap:2px;background:var(--bg-solid);border:1px solid var(--border);border-radius:6px;padding:2px}
.wv-view-btn{padding:3px 10px;border:none;background:transparent;color:var(--text-muted);font-size:11px;font-family:inherit;cursor:pointer;border-radius:4px;transition:all .15s}
.wv-view-btn.active{background:var(--accent);color:#000;font-weight:600}

/* ── Theme switcher ── */
.wv-theme-switcher{position:relative}
.wv-theme-btn{width:28px;height:28px;border:1px solid var(--border);border-radius:6px;background:var(--bg-solid);color:var(--text);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center}
.wv-theme-dropdown{position:absolute;top:32px;right:0;background:var(--bg-solid);border:1px solid var(--border-hover);border-radius:8px;padding:4px;min-width:140px;z-index:40;box-shadow:0 4px 16px rgba(0,0,0,0.4)}
.wv-theme-option{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:none;background:transparent;color:var(--text);font-size:12px;font-family:inherit;cursor:pointer;border-radius:4px;transition:background .1s}
.wv-theme-option:hover,.wv-theme-option.active{background:var(--bg-hover)}
.wv-theme-option .swatch{width:10px;height:10px;border-radius:50%;flex-shrink:0}

/* ── Cesium container ── */
.wv-map{position:relative;flex:1;min-height:0}

/* ── Sidebar ── */
.wv-sidebar{position:absolute;top:0;left:0;bottom:0;width:260px;z-index:25;background:var(--bg-nav);border-right:1px solid var(--border);
  backdrop-filter:blur(12px);overflow-y:auto;overflow-x:hidden;transition:transform .2s ease;
  box-shadow:calc(var(--glow-intensity) * 4px) 0 calc(var(--glow-intensity) * 16px) var(--accent-glow)}
.wv-sidebar.collapsed{transform:translateX(-260px)}
.wv-sidebar::-webkit-scrollbar{width:4px}
.wv-sidebar::-webkit-scrollbar-track{background:transparent}
.wv-sidebar::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

.wv-sidebar-header{padding:12px 14px 8px;border-bottom:1px solid var(--border)}
.wv-sidebar-header h2{margin:0;font-size:13px;font-weight:700;letter-spacing:0.05em}
.wv-sidebar-header p{margin:2px 0 0;font-size:10px;color:var(--text-muted)}

.wv-section{border-bottom:1px solid var(--border)}
.wv-section-header{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;cursor:pointer;font-size:11px;font-weight:600;color:var(--text-dim);user-select:none;transition:background .1s}
.wv-section-header:hover{background:var(--bg-hover)}
.wv-section-header .arrow{font-size:8px;transition:transform .2s}
.wv-section-header.open .arrow{transform:rotate(90deg)}
.wv-section-body{max-height:0;overflow:hidden;transition:max-height .25s ease}
.wv-section-body.open{max-height:600px}

.wv-row{display:flex;align-items:center;justify-content:space-between;padding:5px 14px;font-size:11px}
.wv-row label{display:flex;align-items:center;gap:6px;color:var(--text-dim)}
.wv-row input[type="checkbox"]{accent-color:var(--accent);width:14px;height:14px}

.dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}

.wv-bm-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px 10px 8px}
.wv-bm-btn{padding:5px;border:1px solid var(--border);border-radius:5px;background:transparent;color:var(--text-dim);font-size:10px;font-family:inherit;cursor:pointer;transition:all .15s}
.wv-bm-btn:hover{border-color:var(--border-hover);color:var(--text)}
.wv-bm-btn.active{border-color:var(--accent);color:var(--accent);background:var(--accent-glow)}

.wv-sidebar-toggle{position:absolute;top:50%;z-index:26;width:24px;height:48px;border:1px solid var(--border);border-radius:0 6px 6px 0;
  background:var(--bg-nav);color:var(--text-dim);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:left .2s ease;transform:translateY(-50%)}
.wv-sidebar:not(.collapsed) ~ .wv-sidebar-toggle{left:260px}

/* ── Context menu ── */
.wv-ctx-menu button{display:flex;align-items:center;gap:6px;width:100%;padding:6px 12px;border:none;background:transparent;color:var(--text);font-size:11px;font-family:inherit;cursor:pointer;text-align:left}
.wv-ctx-menu button:hover{background:var(--bg-hover)}

/* ── Elevation popup ── */
.wv-elev-popup{position:absolute;z-index:200;background:var(--bg-solid);border:1px solid var(--border);border-radius:6px;padding:6px 10px;
  box-shadow:0 4px 12px rgba(0,0,0,0.4);pointer-events:none;white-space:nowrap}
.wv-elev-popup .val{font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--accent)}
.wv-elev-popup .coords{font-size:10px;color:var(--text-muted);margin-top:1px}

/* ── Status bar ── */
.wv-status{position:absolute;bottom:0;left:0;right:0;z-index:25;display:flex;align-items:center;gap:12px;
  padding:4px 12px;background:var(--bg-nav);border-top:1px solid var(--border);font-size:10px;backdrop-filter:blur(8px);
  box-shadow:0 calc(var(--glow-intensity) * -4px) calc(var(--glow-intensity) * 12px) var(--accent-glow)}
.wv-status-item{display:flex;align-items:center;gap:4px}
.indicator{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.indicator.ok{background:var(--ok);box-shadow:0 0 calc(var(--glow-intensity) * 6px) var(--ok)}
.indicator.err{background:var(--err)}
.indicator.loading{background:var(--warn);animation:blink 1s step-end infinite}
.indicator.off{background:var(--text-darker)}
.wv-status-sep{width:1px;height:14px;background:var(--border)}
.wv-coords{color:var(--text-muted);font-family:var(--font-mono)}
`;

/* ═══════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════ */

export default function WorldView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const dataLoadedRef = useRef<Record<string, boolean>>({});
  const entitiesRef = useRef<Record<string, any>>({});

  const [state, setState] = useState<DashboardState>(() => {
    if (typeof window === "undefined") return DEFAULT_STATE;
    let savedTheme: string | null = null;
    try { savedTheme = localStorage.getItem("wv-theme"); } catch { /* tracking prevention */ }
    const clean: Partial<DashboardState> = {};
    const parsed = parseHash(window.location.hash);
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) (clean as any)[k] = v;
    }
    return {
      ...DEFAULT_STATE,
      ...clean,
      layers: { ...DEFAULT_LAYERS, ...(parsed.layers || {}) },
      theme: parsed.theme || savedTheme || DEFAULT_STATE.theme,
    };
  });
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ basemaps: true, overlays: true, realtime: true, infrastructure: false, tools: false, theme: false });
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus[]>([
    { key: "earthquakes", label: "Earthquakes", lastUpdate: null, count: 0, error: null },
    { key: "radar", label: "Radar", lastUpdate: null, count: 0, error: null },
    { key: "flights", label: "Flights", lastUpdate: null, count: 0, error: null },
    { key: "militaryFlights", label: "Mil Flights", lastUpdate: null, count: 0, error: null },
    { key: "vessels", label: "Vessels", lastUpdate: null, count: 0, error: null },
    { key: "warnings", label: "Warnings", lastUpdate: null, count: 0, error: null },
    { key: "events", label: "Events", lastUpdate: null, count: 0, error: null },
    { key: "satellites", label: "Satellites", lastUpdate: null, count: 0, error: null },
    { key: "hurricaneTracks", label: "Hurricanes", lastUpdate: null, count: 0, error: null },
    { key: "nlnogNodes", label: "NLNOG Nodes", lastUpdate: null, count: 0, error: null },
    { key: "flightArcs", label: "Flight Arcs", lastUpdate: null, count: 0, error: null },
  ]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; lng: number; lat: number; elev?: number | null } | null>(null);
  const [elevPopup, setElevPopup] = useState<{ x: number; y: number; elev: number | null; lat: number; lon: number } | null>(null);
  const [clock, setClock] = useState("");
  const [bgpPrefix, setBgpPrefix] = useState("");
  const [bgpResult, setBgpResult] = useState<string | null>(null);
  const [bgpLoading, setBgpLoading] = useState(false);

  // UTC clock for HUD themes
  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      setClock(now.toUTCString().split(" ")[4] + "Z");
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Persist theme
  useEffect(() => {
    try { localStorage.setItem("wv-theme", state.theme); } catch { /* tracking prevention */ }
  }, [state.theme]);

  // Update hash
  useEffect(() => {
    window.history.replaceState(null, "", buildHash(state));
  }, [state]);

  const updateStatus = useCallback((key: string, update: Partial<DataStatus>) => {
    setDataStatus((prev) => prev.map((d) => (d.key === key ? { ...d, ...update } : d)));
  }, []);

  // ─── Init Cesium Viewer ───
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    (async () => {
      // Load CesiumJS + satellite.js from CDN
      if (!(window as any).Cesium) {
        // Polyfill for Cesium's use of window.DEFER
        if (!(window as any).DEFER) (window as any).DEFER = Promise.resolve();
        (window as any).CESIUM_BASE_URL = "https://unpkg.com/cesium@1.126.0/Build/Cesium/";
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "https://unpkg.com/cesium@1.126.0/Build/Cesium/Widgets/widgets.css";
        document.head.appendChild(css);
        const js = document.createElement("script");
        js.src = "https://unpkg.com/cesium@1.126.0/Build/Cesium/Cesium.js";
        document.head.appendChild(js);
        await new Promise<void>((res, rej) => { js.onload = () => res(); js.onerror = rej; });
      }
      if (!(window as any).satellite) {
        const sj = document.createElement("script");
        sj.src = "https://cdnjs.cloudflare.com/ajax/libs/satellite.js/5.0.0/satellite.min.js";
        document.head.appendChild(sj);
        await new Promise<void>((res) => { sj.onload = () => res(); });
      }
      if (destroyed) return;

      const Cesium = (window as any).Cesium;

      const viewer = new Cesium.Viewer(containerRef.current, {
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        vrButton: false,
        infoBox: false,
        selectionIndicator: false,
        sceneMode: Cesium.SceneMode.SCENE3D,
        requestRenderMode: Cesium.RequestRenderMode.DEFER,
        maximumRenderTimeChange: Infinity,
      });

      // Set dark globe
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a0e17");
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#0a0e17");
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.fog.enabled = true;
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

      // Set initial view
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(state.center[0], state.center[1], 15000000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      });

      // Load default basemap
      switchBasemapOnViewer(viewer, state.basemap);

      // Mouse tracking
      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement: any) => {
        const cart = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
        if (cart) {
          const cg = Cesium.Cartographic.fromCartesian(cart);
          setCursorPos([+Cesium.Math.toDegrees(cg.longitude).toFixed(4), +Cesium.Math.toDegrees(cg.latitude).toFixed(4)]);
        }
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      handler.setInputAction((click: any) => {
        const cart = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
        if (cart) {
          const cg = Cesium.Cartographic.fromCartesian(cart);
          const lng = +Cesium.Math.toDegrees(cg.longitude);
          const lat = +Cesium.Math.toDegrees(cg.latitude);
          setCtxMenu({ x: click.position.x, y: click.position.y, lng, lat });
          // Fetch elevation
          fetch(`/api/elevation?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`)
            .then((r) => r.json())
            .then((d) => setElevPopup({ x: click.position.x, y: click.position.y, elev: d.elevation, lat, lon: lng }))
            .catch(() => {});
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      handler.setInputAction((click: any) => setCtxMenu(null), Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      document.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest(".wv-ctx-menu")) setCtxMenu(null);
      });

      // Track camera movement for hash update
      viewer.camera.changed.addEventListener(() => {
        const cg = viewer.camera.positionCartographic;
        if (cg) {
          const lng = +Cesium.Math.toDegrees(cg.longitude);
          const lat = +Cesium.Math.toDegrees(cg.latitude);
          const heightM = cg.height;
          const zoomEst = Math.max(1, Math.log2(40075016 / heightM));
          setState((prev) => ({ ...prev, center: [lng, lat], zoom: zoomEst }));
        }
      });

      viewerRef.current = viewer;
      cesiumRef.current = Cesium;
      setLoading(false);
    })();

    return () => {
      destroyed = true;
      intervalsRef.current.forEach(clearInterval);
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Basemap switch ──
  function switchBasemapOnViewer(viewer: any, key: string) {
    const Cesium = (window as any).Cesium;
    const bm = BASEMAPS[key];
    const imageryLayers = viewer.imageryLayers;

    // Remove all custom layers
    while (imageryLayers.length > 0) {
      imageryLayers.remove(imageryLayers.get(0));
    }

    if (bm.url) {
      imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
        url: bm.url,
        credit: "",
      }));
    }
  }

  const switchBasemap = useCallback((key: string) => {
    setState((prev) => ({ ...prev, basemap: key }));
    if (viewerRef.current) switchBasemapOnViewer(viewerRef.current, key);
  }, []);

  // ─── View mode switch ───
  const switchViewMode = useCallback((mode: "3d" | "2d" | "columbus") => {
    setState((prev) => ({ ...prev, viewMode: mode }));
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;
    switch (mode) {
      case "3d": viewer.scene.morphTo3D(1.5); break;
      case "2d": viewer.scene.morphTo2D(1.5); break;
      case "columbus": viewer.scene.morphToColumbusView(1.5); break;
    }
  }, []);

  // ─── Layer toggling ───
  const toggleLayer = useCallback((key: keyof LayerState) => {
    setState((prev) => {
      const next = { ...prev, layers: { ...prev.layers, [key]: !prev.layers[key] } };
      const on = next.layers[key];
      const Cesium = cesiumRef.current;
      const viewer = viewerRef.current;
      if (!Cesium || !viewer) return next;

      switch (key) {
        case "earthquakes":
          if (on && !dataLoadedRef.current.earthquakes) loadEarthquakes();
          if (!on) { removeEntities("eq-"); }
          break;
        case "radar":
          if (on && !dataLoadedRef.current.radar) loadRadar();
          if (!on) removeEntities("radar-"); break;
        case "flights":
          if (on && !dataLoadedRef.current.flights) loadFlights();
          if (!on) removeEntities("flight-"); break;
        case "militaryFlights":
          if (on && !dataLoadedRef.current.militaryFlights) loadMilitaryFlights();
          if (!on) removeEntities("mil-"); break;
        case "vessels":
          if (on && !dataLoadedRef.current.vessels) loadVessels();
          if (!on) removeEntities("vessel-"); break;
        case "warnings":
          if (on && !dataLoadedRef.current.warnings) loadWarnings();
          if (!on) removeEntities("warn-"); break;
        case "events":
          if (on && !dataLoadedRef.current.events) loadEvents();
          if (!on) removeEntities("event-"); break;
        case "satellites":
          if (on && !dataLoadedRef.current.satellites) loadSatellites();
          if (!on) removeEntities("sat-"); break;
        case "hurricaneTracks":
          if (on && !dataLoadedRef.current.hurricaneTracks) loadHurricanes();
          if (!on) removeEntities("storm-"); break;
        case "satellite":
          if (on) toggleImageryOverlay(viewer, "nasa-gibs",
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.3.0&LAYER=MODIS_Terra_CorrectedReflectance_TrueColor&TILEMATRIXSET=GoogleMapsCompatible&TILECOL={z}&TILEROW={y}&TILEMATRIX={z}&FORMAT=image%2Fpng",
            0.7
          );
          else toggleImageryOverlay(viewer, "nasa-gibs"); break;
        case "blueMarble":
          if (on) toggleImageryOverlay(viewer, "BlueMarble_ShadedRelief",
            "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/BlueMarble_ShadedRelief/default/{z}/{y}/{x}.jpg",
            0.85
          );
          else toggleImageryOverlay(viewer, "BlueMarble_ShadedRelief"); break;
        case "nightLights":
          if (on) toggleImageryOverlay(viewer, "VIIRS_CityLights",
            "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_CityLights_2012/default/{z}/{y}/{x}.jpg",
            1.0
          );
          else toggleImageryOverlay(viewer, "VIIRS_CityLights"); break;
        case "nlnogNodes":
          if (on && !dataLoadedRef.current.nlnogNodes) loadNlnogNodes();
          if (!on) removeEntities("nlnog-"); break;
        case "flightArcs":
          if (on && !dataLoadedRef.current.flightArcs) loadFlightArcs();
          if (!on) removeEntities("arc-"); break;
        case "hillshade":
          // Hillshade is built into terrain in Cesium
          break;
        case "elevationColor":
          if (on) loadElevationColor();
          else removeEntities("elev-"); break;
      }
      return next;
    });
  }, []);

  function removeEntities(prefix: string) {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const ds = viewer.dataSources;
    const toRemove: any[] = [];
    ds.forEach((dsItem: any) => {
      if (dsItem.name && dsItem.name.startsWith(prefix)) toRemove.push(dsItem);
    });
    toRemove.forEach((d: any) => ds.remove(d));
  }

  function toggleImageryOverlay(viewer: any, name: string, url?: string, opacity?: number) {
    const Cesium = cesiumRef.current;
    if (!Cesium) return;
    const layers = viewer.imageryLayers;
    const existing = layers._layers.find((l: any) => {
      const providerUrl = l._imageryProvider?.url || "";
      return providerUrl.includes(name);
    });
    if (existing) {
      layers.remove(existing);
    } else if (url) {
      layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url, credit: "" }));
      const idx = layers.length - 1;
      if (opacity !== undefined && layers.get(idx)) {
        (layers.get(idx) as any).alpha = opacity;
      }
    }
  }

  // ─── Section/theme toggles ───
  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const switchTheme = useCallback((key: string) => {
    setState((prev) => ({ ...prev, theme: key }));
    setThemeDropdownOpen(false);
  }, []);

  // ─── Data Loaders ───
  const loadEarthquakes = useCallback(async () => {
    updateStatus("earthquakes", { error: null });
    try {
      const data = await fetchEarthquakes();
      const Cesium = cesiumRef.current;
      const viewer = viewerRef.current;
      if (!Cesium || !viewer) return;
      const features = data.features || [];
      updateStatus("earthquakes", { lastUpdate: Date.now(), count: features.length });

      features.forEach((f: any, i: number) => {
        const coords = f.geometry?.coordinates;
        if (!coords) return;
        const mag = f.properties?.mag || 0;
        const color = mag >= 7 ? Cesium.Color.RED : mag >= 5 ? Cesium.Color.ORANGE : mag >= 3 ? Cesium.Color.YELLOW : Cesium.Color.LIME;
        const radius = Math.max(3000, mag * 8000);
        viewer.entities.add({
          id: `eq-${i}`,
          name: `EQ ${mag.toFixed(1)}`,
          position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
          ellipse: { semiMinorAxis: radius, semiMajorAxis: radius, material: new Cesium.ColorMaterialProperty({ color, transparent: true, alpha: 0.35 }) },
          point: { pixelSize: Math.max(4, mag * 1.5), color, outlineColor: Cesium.Color.WHITE.withAlpha(0.3) },
          properties: { type: "earthquake", ...f.properties },
        });
      });
      dataLoadedRef.current.earthquakes = true;

      const iv = setInterval(async () => {
        if (!state.layers.earthquakes) return;
        try {
          const d = await fetchEarthquakes();
          // Remove old, add new
          removeEntities("eq-");
          (d.features || []).forEach((f: any, i: number) => {
            const c = f.geometry?.coordinates;
            if (!c) return;
            const m = f.properties?.mag || 0;
            viewer.entities.add({ id: `eq-${i}`, position: Cesium.Cartesian3.fromDegrees(c[0], c[1], 0), ellipse: { semiMinorAxis: Math.max(3000, m * 8000), semiMajorAxis: Math.max(3000, m * 8000), material: new Cesium.ColorMaterialProperty({ color: m >= 7 ? Cesium.Color.RED : m >= 5 ? Cesium.Color.ORANGE : Cesium.Color.YELLOW, transparent: true, alpha: 0.35 }) }, properties: { type: "earthquake" } });
          });
          updateStatus("earthquakes", { lastUpdate: Date.now(), count: (d.features || []).length });
        } catch { /* retry */ }
      }, 60000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("earthquakes", { error: "fetch failed" }); }
  }, [updateStatus, state.layers.earthquakes]);

  const loadRadar = useCallback(async () => {
    updateStatus("radar", { error: null });
    try {
      const data = await fetchRainViewer();
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!Cesium || !viewer || !data.radar?.past?.length) return;
      const latest = data.radar.past[data.radar.past.length - 1];
      updateStatus("radar", { lastUpdate: Date.now(), count: 1 });
      toggleImageryOverlay(viewer, "rainviewer", `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`, 0.6);
      dataLoadedRef.current.radar = true;
      const iv = setInterval(async () => {
        if (!state.layers.radar) return;
        try {
          const d = await fetchRainViewer();
          const lt = d.radar?.past?.[d.radar.past.length - 1];
          if (lt) { toggleImageryOverlay(viewer, "rainviewer", `https://tilecache.rainviewer.com${lt.path}/256/{z}/{x}/{y}/2/1_1.png`, 0.6); updateStatus("radar", { lastUpdate: Date.now(), count: 1 }); }
        } catch { /* retry */ }
      }, 600000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("radar", { error: "fetch failed" }); }
  }, [updateStatus, state.layers.radar]);

  const loadFlights = useCallback(async () => {
    updateStatus("flights", { error: null });
    try {
      const data = await fetchFlights();
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!Cesium || !viewer || !data.states) return;
      const states = data.states.filter((s: any[]) => s[5] != null && s[6] != null);
      updateStatus("flights", { lastUpdate: Date.now(), count: states.length });

      states.forEach((s: any[], i: number) => {
        const callsign = (s[1] || "").trim();
        const alt = s[7] || 0;
        const spd = s[9] || 0;
        const hdg = s[10] || 0;
        const color = alt > 10000 ? Cesium.Color.RED : alt > 5000 ? Cesium.Color.ORANGE : Cesium.Color.LIME;
        viewer.entities.add({
          id: `flight-${i}`,
          name: callsign || "N/A",
          position: Cesium.Cartesian3.fromDegrees(s[5], s[6], alt),
          point: { pixelSize: 4, color, outlineColor: Cesium.Color.WHITE.withAlpha(0.2) },
          label: callsign ? { text: callsign, font: "11px sans-serif", fillColor: Cesium.Color.WHITE.withAlpha(0.8), outlineColor: Cesium.Color.BLACK, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(8, -8), verticalOrigin: Cesium.VerticalOrigin.CENTER, showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.5), backgroundPadding: new Cesium.Cartesian2(3, 2) } : undefined,
          properties: { type: "flight", callsign, altitude: alt, speed: spd, heading: hdg, country: s[2] },
        });
      });
      dataLoadedRef.current.flights = true;
      const iv = setInterval(async () => {
        if (!state.layers.flights) return;
        try {
          const d = await fetchFlights();
          if (d.states) { removeEntities("flight-"); d.states.filter((s: any[]) => s[5] != null && s[6] != null).forEach((s: any[], i: number) => { const cs = (s[1] || "").trim(); const a = s[7] || 0; viewer.entities.add({ id: `flight-${i}`, position: Cesium.Cartesian3.fromDegrees(s[5], s[6], a), point: { pixelSize: 4, color: a > 10000 ? Cesium.Color.RED : a > 5000 ? Cesium.Color.ORANGE : Cesium.Color.LIME }, label: cs ? { text: cs, font: "11px sans-serif", fillColor: Cesium.Color.WHITE.withAlpha(0.8), style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(8, -8), showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.5), backgroundPadding: new Cesium.Cartesian2(3, 2) } : undefined }); }); updateStatus("flights", { lastUpdate: Date.now(), count: d.states.filter((s: any[]) => s[5] != null).length }); }
        } catch { /* retry */ }
      }, 15000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("flights", { error: "fetch failed" }); }
  }, [updateStatus, state.layers.flights]);

  const loadMilitaryFlights = useCallback(async () => {
    updateStatus("militaryFlights", { error: null });
    try {
      const data = await fetchMilitaryFlights();
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!Cesium || !viewer || !data.ac) return;
      const ac = data.ac.filter((a: any) => a.lat && a.lon);
      updateStatus("militaryFlights", { lastUpdate: Date.now(), count: ac.length });
      ac.forEach((a: any, i: number) => {
        const alt = a.alt_baro || a.alt_geom || 0;
        viewer.entities.add({
          id: `mil-${i}`,
          name: a.call || a.reg || "MIL",
          position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, alt),
          point: { pixelSize: 5, color: Cesium.Color.MAGENTA, outlineColor: Cesium.Color.WHITE.withAlpha(0.3) },
          label: { text: a.call || "", font: "bold 10px monospace", fillColor: Cesium.Color.MAGENTA, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(8, -8), showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.6), backgroundPadding: new Cesium.Cartesian2(3, 2) },
          properties: { type: "military", ...a },
        });
      });
      dataLoadedRef.current.militaryFlights = true;
      const iv = setInterval(async () => {
        if (!state.layers.militaryFlights) return;
        try {
          const d = await fetchMilitaryFlights();
          if (d.ac) { removeEntities("mil-"); d.ac.filter((a: any) => a.lat && a.lon).forEach((a: any, i: number) => { viewer.entities.add({ id: `mil-${i}`, position: Cesium.Cartesian3.fromDegrees(a.lon, a.lat, a.alt_baro || 0), point: { pixelSize: 5, color: Cesium.Color.MAGENTA }, label: { text: a.call || "", font: "bold 10px monospace", fillColor: Cesium.Color.MAGENTA, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(8, -8), showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.6), backgroundPadding: new Cesium.Cartesian2(3, 2) } }); }); updateStatus("militaryFlights", { lastUpdate: Date.now(), count: d.ac.filter((a: any) => a.lat && a.lon).length }); }
        } catch { /* retry */ }
      }, 30000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("militaryFlights", { error: "fetch failed" }); }
  }, [updateStatus, state.layers.militaryFlights]);

  const loadVessels = useCallback(async () => {
    updateStatus("vessels", { error: null });
    try {
      // Placeholder - AIS data via proxy or public feed
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!Cesium || !viewer) return;
      updateStatus("vessels", { lastUpdate: Date.now(), count: 0 });
      dataLoadedRef.current.vessels = true;
    } catch { updateStatus("vessels", { error: "fetch failed" }); }
  }, [updateStatus, state.layers.vessels]);

  const loadWarnings = useCallback(async () => {
    updateStatus("warnings", { error: null });
    try {
      const data = await fetchWarnings();
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!Cesium || !viewer || !data.features) return;
      updateStatus("warnings", { lastUpdate: Date.now(), count: data.features.length });
      data.features.forEach((f: any, i: number) => {
        const et = (f.properties?.Event || "").toLowerCase();
        let color = Cesium.Color.YELLOW;
        if (et.includes("tornado") || et.includes("extreme")) color = Cesium.Color.RED;
        else if (et.includes("severe") || et.includes("warning")) color = Cesium.Color.ORANGE;
        if (f.geometry?.type === "Polygon") {
          viewer.entities.add({
            id: `warn-${i}`,
            polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(f.geometry.coordinates.flat(10)), material: new Cesium.ColorMaterialProperty({ color, transparent: true, alpha: 0.15 }) },
            properties: { type: "warning" },
          });
        }
      });
      dataLoadedRef.current.warnings = true;
      const iv = setInterval(async () => {
        if (!state.layers.warnings) return;
        try {
          const d = await fetchWarnings();
          if (d.features) { removeEntities("warn-"); d.features.forEach((f: any, i: number) => { const et = (f.properties?.Event || "").toLowerCase(); let c = Cesium.Color.YELLOW; if (et.includes("tornado") || et.includes("extreme")) c = Cesium.Color.RED; else if (et.includes("severe") || et.includes("warning")) c = Cesium.Color.ORANGE; if (f.geometry?.type === "Polygon") viewer.entities.add({ id: `warn-${i}`, polygon: { hierarchy: Cesium.Cartesian3.fromDegreesArray(f.geometry.coordinates.flat(10)), material: new Cesium.ColorMaterialProperty({ color: c, transparent: true, alpha: 0.15 }) } }); }); updateStatus("warnings", { lastUpdate: Date.now(), count: d.features.length }); }
        } catch { /* retry */ }
      }, 300000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("warnings", { error: "fetch failed" }); }
  }, [updateStatus, state.layers.warnings]);

  const loadEvents = useCallback(async () => {
    updateStatus("events", { error: null });
    try {
      const data = await fetchEONET();
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!Cesium || !viewer) return;
      const features = data.features || [];
      updateStatus("events", { lastUpdate: Date.now(), count: features.length });
      features.forEach((f: any, i: number) => {
        const cat = f.properties?.categories?.[0]?.id || "manmade";
        const colorStr = EONET_COLORS[cat] || "#888888";
        const coords = f.geometry?.coordinates;
        if (!coords) return;
        const c = Cesium.Color.fromCssColorString(colorStr);
        viewer.entities.add({
          id: `event-${i}`,
          position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 0),
          point: { pixelSize: 6, color: c, outlineColor: Cesium.Color.WHITE.withAlpha(0.3) },
          label: { text: f.properties?.title || cat, font: "10px sans-serif", fillColor: c.withAlpha(0.9), style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(8, -8), showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.5), backgroundPadding: new Cesium.Cartesian2(3, 2) },
          properties: { type: "event" },
        });
      });
      dataLoadedRef.current.events = true;
      const iv = setInterval(async () => {
        if (!state.layers.events) return;
        try {
          const d = await fetchEONET(); const fs = d.features || []; removeEntities("event-"); fs.forEach((f: any, i: number) => { const cat = f.properties?.categories?.[0]?.id || "manmade"; const c = Cesium.Color.fromCssColorString(EONET_COLORS[cat] || "#888888"); const co = f.geometry?.coordinates; if (!co) return; viewer.entities.add({ id: `event-${i}`, position: Cesium.Cartesian3.fromDegrees(co[0], co[1], 0), point: { pixelSize: 6, color: c }, label: { text: f.properties?.title || cat, font: "10px sans-serif", fillColor: c.withAlpha(0.9), style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(8, -8), showBackground: true, backgroundColor: Cesium.Color.BLACK.withAlpha(0.5), backgroundPadding: new Cesium.Cartesian2(3, 2) } }); }); updateStatus("events", { lastUpdate: Date.now(), count: fs.length });
        } catch { /* retry */ }
      }, 1800000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("events", { error: "fetch failed" }); }
  }, [updateStatus, state.layers.events]);

  const loadSatellites = useCallback(async () => {
    updateStatus("satellites", { error: null });
    try {
      const tles = await fetchCelestrak();
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      const satJs = (window as any).satellite;
      if (!Cesium || !viewer || !Array.isArray(tles)) return;
      const now = new Date();
      const features = tles.slice(0, 3000).filter((t: any) => t.TLE_LINE1 && t.TLE_LINE2).map((t: any) => {
        let coords: [number, number, number] | null = null;
        if (satJs) {
          try {
            const satrec = satJs.twoline2satrec(t.TLE_LINE1, t.TLE_LINE2);
            const pos = satJs.propagate(satrec, now);
            if (pos.position) {
              const gd = satJs.eciToGeodetic(pos.position, satJs.gstime(now));
              coords = [satJs.degreesLong(gd.longitude), satJs.degreesLat(gd.latitude), (pos.position.z / 1000) - 6371];
            }
          } catch { /* skip */ }
        }
        return { tle: t.TLE_LINE1, name: t.NAME || t.OBJECT_NAME, coords };
      }).filter((f: any) => f.coords);
      updateStatus("satellites", { lastUpdate: Date.now(), count: features.length });
      features.forEach((f: any, i: number) => {
        viewer.entities.add({
          id: `sat-${i}`,
          position: Cesium.Cartesian3.fromDegrees(f.coords[0], f.coords[1], Math.max(f.coords[2], 160)),
          point: { pixelSize: 2, color: Cesium.Color.CYAN.withAlpha(0.5) },
          properties: { type: "satellite" },
        });
      });
      dataLoadedRef.current.satellites = true;
      const iv = setInterval(async () => {
        if (!state.layers.satellites) return;
        try {
          const t = await fetchCelestrak(); if (!Array.isArray(t)) return; const sj = (window as any).satellite; const n = new Date();
          removeEntities("sat-");
          t.slice(0, 3000).filter((x: any) => x.TLE_LINE1 && x.TLE_LINE2).map((x: any) => { let c: [number, number, number] | null = null; if (sj) { try { const sr = sj.twoline2satrec(x.TLE_LINE1, x.TLE_LINE2); const p = sj.propagate(sr, n); if (p.position) { const g = sj.eciToGeodetic(p.position, sj.gstime(n)); c = [sj.degreesLong(g.longitude), sj.degreesLat(g.latitude), (p.position.z / 1000) - 6371]; } } catch { /* skip */ } } return { tle: x.TLE_LINE1, coords: c }; }).filter((f: any) => f.coords).forEach((f: any, i: number) => { viewer.entities.add({ id: `sat-${i}`, position: Cesium.Cartesian3.fromDegrees(f.coords[0], f.coords[1], Math.max(f.coords[2], 160)), point: { pixelSize: 2, color: Cesium.Color.CYAN.withAlpha(0.5) } }); });
          updateStatus("satellites", { lastUpdate: Date.now(), count: t.slice(0, 3000).filter((x: any) => x.TLE_LINE1 && x.TLE_LINE2).length });
        } catch { /* retry */ }
      }, 300000);
      intervalsRef.current.push(iv);
    } catch { updateStatus("satellites", { error: "fetch failed" }); }
  }, [updateStatus, state.layers.satellites]);

  const loadHurricanes = useCallback(async () => {
    updateStatus("hurricaneTracks", { error: null });
    try {
      const csv = await fetchHurricaneTracks();
      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      if (!Cesium || !viewer) return;
      const lines = csv.split("\n").slice(1);
      const storms: Record<string, any[]> = {};
      const CAT_COLORS: Record<string, string> = { TS: "#00aaff", Cat1: "#ffff00", Cat2: "#ffcc00", Cat3: "#ff8800", Cat4: "#ff4400", Cat5: "#ff0000", SD: "#666", SS: "#888", TD: "#aaa", EX: "#ccc" };
      for (const line of lines) {
        const p = line.split(",");
        if (p.length < 10) continue;
        const sid = p[0]?.trim();
        const name = p[8]?.trim();
        const lat = parseFloat(p[6]);
        const lon = parseFloat(p[7]);
        const cat = p[10]?.trim() || "TS";
        if (isNaN(lat) || isNaN(lon)) continue;
        if (!storms[sid]) storms[sid] = [];
        storms[sid].push({ coordinates: [lon, lat], cat, name, color: CAT_COLORS[cat] || "#aaa" });
      }
      let count = 0;
      for (const [, track] of Object.entries(storms)) {
        if (track.length < 2) continue;
        const positions = track.map((pt: any) => Cesium.Cartesian3.fromDegrees(pt.coordinates[0], pt.coordinates[1]));
        const color = Cesium.Color.fromCssColorString(track[track.length - 1].color);
        viewer.entities.add({ id: `storm-${count}`, polyline: { positions, width: 3, material: new Cesium.ColorMaterialProperty({ color, transparent: true, alpha: 0.7 }) }, properties: { type: "storm" } });
        count++;
      }
      updateStatus("hurricaneTracks", { lastUpdate: Date.now(), count });
      dataLoadedRef.current.hurricaneTracks = true;
    } catch { updateStatus("hurricaneTracks", { error: "fetch failed" }); }
  }, [updateStatus]);

  const loadNlnogNodes = useCallback(async () => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!Cesium || !viewer) return;
    try {
      updateStatus("nlnogNodes", { error: null });
      const res = await fetch("/api/nlnog");
      const data = await res.json();
      if (!data.nodes) { updateStatus("nlnogNodes", { error: "no data" }); return; }
      const nodes = data.nodes as any[];
      const ds = Cesium.CustomDataSource("NLNOG Ring Nodes");
      for (const node of nodes) {
        ds.entities.add({
          id: `nlnog-${node.id}`,
          position: Cesium.Cartesian3.fromDegrees(node.lon, node.lat),
          point: { pixelSize: 5, color: Cesium.Color.fromCssColorString("#f97316"), outlineColor: Cesium.Color.BLACK.withAlpha(0.3), outlineWidth: 1 },
          label: { text: node.city || node.hostname, font: "10px sans-serif", style: Cesium.LabelStyle.FILL, fillColor: Cesium.Color.WHITE.withAlpha(0.8), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, pixelOffset: new Cesium.Cartesian2(0, -10), showBackground: true, backgroundColor: new Cesium.Color(0, 0, 0, 0.6), backgroundPadding: new Cesium.Cartesian2(4, 3) },
          properties: { type: "nlnog", asn: node.asn, hostname: node.hostname, country: node.country },
        });
      }
      viewer.dataSources.add(ds);
      updateStatus("nlnogNodes", { lastUpdate: Date.now(), count: nodes.length });
      dataLoadedRef.current.nlnogNodes = true;
    } catch { updateStatus("nlnogNodes", { error: "fetch failed" }); }
  }, [updateStatus]);

  const loadFlightArcs = useCallback(async () => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!Cesium || !viewer) return;
    try {
      updateStatus("flightArcs", { error: null });
      const res = await fetch("https://opensky-network.org/api/states/all");
      const data = await res.json();
      if (!data.states) { updateStatus("flightArcs", { error: "no data" }); return; }
      const highAlt = data.states.filter((s: any[]) => s[5] != null && s[6] != null && (s[7] || 0) > 30000);
      // Create arcs between random pairs of high-altitude flights
      const shuffled = highAlt.sort(() => Math.random() - 0.5).slice(0, 200);
      let arcCount = 0;
      for (let i = 0; i < shuffled.length - 1; i += 2) {
        const a = shuffled[i];
        const b = shuffled[i + 1];
        const lonA = a[5], latA = a[6], altA = a[7] || 0;
        const lonB = b[5], latB = b[6], altB = b[7] || 0;
        const dist = Math.sqrt((lonA - lonB) ** 2 + (latA - latB) ** 2);
        if (dist < 15 || dist > 80) continue; // Only connect flights at medium range
        // Generate great-circle arc positions
        const positions: any[] = [];
        const segments = 30;
        for (let t = 0; t <= segments; t++) {
          const frac = t / segments;
          const lat = latA + (latB - latA) * frac;
          const lon = lonA + (lonB - lonA) * frac;
          const alt = Math.max(altA, altB) * (1 + 0.5 * Math.sin(Math.PI * frac)); // Arc peaks in middle
          positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, alt));
        }
        const altRatio = Math.max(altA, altB) / 45000;
        const color = Cesium.Color.fromHsl(0.6 - altRatio * 0.2, 0.8, 0.6, 0.3);
        viewer.entities.add({
          id: `arc-${arcCount}`,
          polyline: { positions, width: 1.5, material: new Cesium.ColorMaterialProperty({ color, transparent: true }) },
          properties: { type: "arc" },
        });
        arcCount++;
      }
      updateStatus("flightArcs", { lastUpdate: Date.now(), count: arcCount });
      dataLoadedRef.current.flightArcs = true;
    } catch { updateStatus("flightArcs", { error: "fetch failed" }); }
  }, [updateStatus]);

  const loadElevationColor = useCallback(async () => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!Cesium || !viewer) return;
    // Sample elevation along current view bounds and create color-coded points
    const camera = viewer.camera;
    const cg = camera.positionCartographic;
    const lng = Cesium.Math.toDegrees(cg.longitude);
    const lat = Cesium.Math.toDegrees(cg.latitude);
    const height = cg.height;
    const span = height * 0.8;
    const step = Math.max(span / 20, 0.5);
    let count = 0;
    for (let dlng = -span / 2; dlng <= span / 2; dlng += step) {
      for (let dlat = -span / 2; dlat <= span / 2; dlat += step) {
        try {
          const r = await fetch(`/api/elevation?lat=${(lat + dlat).toFixed(4)}&lon=${(lng + dlng).toFixed(4)}`);
          const d = await r.json();
          if (d.elevation !== null && d.elevation !== -32768) {
            const c = Cesium.Color.fromCssColorString(elevationColor(d.elevation));
            viewer.entities.add({
              id: `elev-${count}`,
              position: Cesium.Cartesian3.fromDegrees(lng + dlng, lat + dlat, 0),
              point: { pixelSize: 3, color: c, outlineColor: Cesium.Color.BLACK.withAlpha(0.2) },
              properties: { type: "elevation", elevation: d.elevation },
            });
            count++;
          }
        } catch { /* skip */ }
      }
    }
    dataLoadedRef.current.elevationColor = true;
  }, []);

  // ─── Load initial layers ───
  useEffect(() => {
    if (!loading) {
      if (state.layers.earthquakes) loadEarthquakes();
      if (state.layers.events) loadEvents();
    }
  }, [loading, state.layers.earthquakes, state.layers.events, loadEarthquakes, loadEvents]);

  // ─── Render ───
  const currentTheme = THEMES[state.theme] || THEMES.default;
  const isHud = state.theme === "classified" || state.theme === "crimson";
  const themeStyle = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const pair of currentTheme.css.split(";")) {
      const idx = pair.indexOf(":");
      if (idx === -1) continue;
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k && v) obj[k] = v;
    }
    return obj;
  }, [currentTheme.css]);

  return (
    <div className="wv-wrap" style={themeStyle as React.CSSProperties}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {loading && (
        <div className="wv-loading-overlay"><div className="spinner" /></div>
      )}

      <div className="wv-scanlines" />
      <div className="wv-grid-overlay" />
      <div className="wv-hud-corners"><div className="wv-hud-inner" /></div>

      {isHud && (
        <div className="wv-classification">
          {state.theme === "classified" ? "TOP SECRET // SCI" : "RESTRICTED // OPERATIONAL"}
          <span className="wv-blink" style={{ marginLeft: 12, fontSize: 9, opacity: 0.5 }}>●</span>
        </div>
      )}

      {isHud && (
        <div className="wv-ticker">
          <div className="wv-ticker-inner">
            SIGINT FEED ACTIVE ◆ GEOSPATIAL INTEL COLLECTION IN PROGRESS ◆ ALL SOURCES NOMINAL ◆
            {dataStatus.filter((d) => d.lastUpdate).map((d) => `${d.label.toUpperCase()}: ${d.count} OBJECTS`).join(" ◆ ")} ◆
            LAT {cursorPos ? cursorPos[1] : "----"} LON {cursorPos ? cursorPos[0] : "----"} ◆
            ZOOM {state.zoom.toFixed(1)} ◆ VIEW {state.viewMode.toUpperCase()} ◆ {clock}
          </div>
        </div>
      )}

      {/* Nav */}
      <Navbar
        dark
        breadcrumb="Globe"
        extra={
          <>
            {/* View mode toggle */}
            <div className="wv-view-toggle">
              {(["3d", "columbus", "2d"] as const).map((mode) => (
                <button key={mode} className={`wv-view-btn ${state.viewMode === mode ? "active" : ""}`} onClick={() => switchViewMode(mode)}>
                  {mode === "3d" ? "3D" : mode === "columbus" ? "CB" : "2D"}
                </button>
              ))}
            </div>
            {isHud && <span className="wv-nav-time">{clock}</span>}
            <div className="wv-theme-switcher">
              <button className="wv-theme-btn" onClick={() => setThemeDropdownOpen(!themeDropdownOpen)} title="Change theme">{currentTheme.icon}</button>
              {themeDropdownOpen && (
                <div className="wv-theme-dropdown">
                  {Object.entries(THEMES).map(([k, v]) => (
                    <button key={k} className={`wv-theme-option ${state.theme === k ? "active" : ""}`} onClick={() => switchTheme(k)}>
                      <span className="swatch" style={{ background: k === "default" ? "#4a9eff" : k === "classified" ? "#00ff41" : k === "amber" ? "#ffb000" : k === "arctic" ? "#00ccff" : "#ff2222" }} />
                      {v.icon} {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        }
      />

      <div ref={containerRef} className="wv-map" />

      {/* Sidebar */}
      <div className={`wv-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="wv-sidebar-header">
          <h2 className={isHud ? "wv-glow" : ""}>{isHud ? "◆ " : ""}GLOBE</h2>
          <p>{isHud ? "GEOINT ANALYSIS TERMINAL" : "Real-Time Geospatial Intelligence"}</p>
        </div>

        {/* Basemaps */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.basemaps ? "open" : ""}`} onClick={() => toggleSection("basemaps")}>
            <span>Basemaps</span><span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.basemaps ? "open" : ""}`}>
            <div className="wv-bm-grid">
              {Object.entries(BASEMAPS).map(([k, v]) => (
                <button key={k} className={`wv-bm-btn ${state.basemap === k ? "active" : ""}`} onClick={() => switchBasemap(k)}>{v.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Dynamic layer sections from registry */}
        {SIDEBAR_SECTIONS.map((section) => (
          <div className="wv-section" key={section.key}>
            <div className={`wv-section-header ${openSections[section.key as keyof typeof openSections] ? "open" : ""}`} onClick={() => toggleSection(section.key as any)}>
              <span>{section.title}</span><span className="arrow">&#9654;</span>
            </div>
            <div className={`wv-section-body ${openSections[section.key as keyof typeof openSections] ? "open" : ""}`}>
              {section.layerIds.map((layerId) => {
                const layer = LAYER_MAP[layerId];
                const checked = (state.layers as unknown as Record<string, boolean>)[layerId] ?? false;
                return (
                  <div className="wv-row" key={layerId}>
                    <label>
                      <span className="dot" style={{ background: layer?.accent || "var(--accent)" }} />
                      {layer?.name || layerId}
                    </label>
                    <input type="checkbox" checked={checked} onChange={() => toggleLayer(layerId as any)} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Tools */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.tools ? "open" : ""}`} onClick={() => toggleSection("tools")}>
            <span>Tools</span><span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.tools ? "open" : ""}`}>
            <div className="wv-row"><label style={{ color: "var(--text-muted)", fontSize: "11px" }}>Click globe for elevation query</label></div>
            <div className="wv-row"><label style={{ color: "var(--text-muted)", fontSize: "11px" }}>Right-click for coordinates</label></div>
            <div className="wv-row">
              <label style={{ color: "#38bdf8", fontSize: "11px" }}>BGP Prefix Lookup</label>
            </div>
            <div className="wv-row" style={{ gap: 4 }}>
              <input
                type="text"
                placeholder="e.g. 8.8.8.0/24"
                value={bgpPrefix}
                onChange={(e) => setBgpPrefix(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setBgpLoading(true); setBgpResult(null); fetch(`/api/bgp?prefix=${encodeURIComponent(bgpPrefix)}`).then(r => r.json()).then(d => { setBgpResult(JSON.stringify(d.data || d.error, null, 2)); setBgpLoading(false); }).catch(() => { setBgpResult("Query failed"); setBgpLoading(false); }); } }}
                style={{ flex: 1, background: "#1a1a1a", border: "1px solid #333", borderRadius: 3, padding: "2px 6px", color: "#ccc", fontSize: "11px", outline: "none" }}
              />
              <button
                onClick={() => { setBgpLoading(true); setBgpResult(null); fetch(`/api/bgp?prefix=${encodeURIComponent(bgpPrefix)}`).then(r => r.json()).then(d => { setBgpResult(JSON.stringify(d.data || d.error, null, 2)); setBgpLoading(false); }).catch(() => { setBgpResult("Query failed"); setBgpLoading(false); }); }}
                disabled={!bgpPrefix || bgpLoading}
                style={{ background: "#333", border: "none", borderRadius: 3, padding: "2px 8px", color: "#ccc", fontSize: "11px", cursor: bgpPrefix ? "pointer" : "default" }}
              >{bgpLoading ? "..." : "Go"}</button>
            </div>
            {bgpResult && (
              <div className="wv-row">
                <pre style={{ color: "#888", fontSize: "10px", fontFamily: "monospace", maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{bgpResult}</pre>
              </div>
            )}
            <div className="wv-row"><label style={{ color: "var(--text-muted)", fontSize: "11px" }}>Sources: USGS, RainViewer, NASA, OpenSky, ADSB-X, NOAA, Celestrak, NLNOG</label></div>
          </div>
        </div>

        {/* Theme */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.theme ? "open" : ""}`} onClick={() => toggleSection("theme")}>
            <span>Theme</span><span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.theme ? "open" : ""}`}>
            <div className="wv-bm-grid">
              {Object.entries(THEMES).map(([k, v]) => (
                <button key={k} className={`wv-bm-btn ${state.theme === k ? "active" : ""}`} onClick={() => switchTheme(k)}>{v.icon} {v.label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar toggle */}
      <button className="wv-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} style={{ left: sidebarOpen ? 260 : 0 }}>
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>

      {/* Close theme dropdown on outside click */}
      {themeDropdownOpen && <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setThemeDropdownOpen(false)} />}

      {/* Context menu */}
      {ctxMenu && (
        <div className="wv-ctx-menu" style={{ position: "fixed", top: ctxMenu.y, left: ctxMenu.x, zIndex: 200, background: "var(--bg-solid)", border: "1px solid var(--border-hover)", borderRadius: 6, padding: "4px 0", minWidth: 190, boxShadow: "0 4px 12px rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}>
          <button onClick={() => { safeCopy(`${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`); setCtxMenu(null); }}>Copy coordinates</button>
          <button onClick={() => { safeCopy(`${ctxMenu.lat.toFixed(6)},${ctxMenu.lng.toFixed(6)}`); setCtxMenu(null); }}>Copy compact</button>
          <button onClick={() => { const toDms = (d: number, pos: string, neg: string) => { const dir = d >= 0 ? pos : neg; const a = Math.abs(d); const deg = Math.floor(a); const min = Math.floor((a - deg) * 60); const sec = ((a - deg - min / 60) * 3600).toFixed(2); return `${deg}\u00b0${min}'${sec}"${dir}`; }; safeCopy(`${toDms(ctxMenu.lat, "N", "S")} ${toDms(ctxMenu.lng, "E", "W")}`); setCtxMenu(null); }}>Copy DMS</button>
          <button onClick={() => { window.open(`https://www.openstreetmap.org/?mlat=${ctxMenu.lat}&mlon=${ctxMenu.lng}#map=17/${ctxMenu.lat}/${ctxMenu.lng}`, "_blank"); setCtxMenu(null); }} style={{ color: "var(--accent)" }}>Open in OSM</button>
          <button onClick={async () => { try { const r = await fetch(`/api/elevation?lat=${ctxMenu.lat.toFixed(6)}&lon=${ctxMenu.lng.toFixed(6)}`); const d = await r.json(); safeCopy(`${d.elevation !== null ? d.elevation + "m" : "No data"} @ ${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`); } catch { /* */ } setCtxMenu(null); }} style={{ color: "var(--ok)" }}>Copy elevation</button>
        </div>
      )}

      {/* Elevation popup */}
      {elevPopup && (
        <div className="wv-elev-popup" style={{ left: elevPopup.x + 16, top: elevPopup.y - 10 }}>
          <div className="val">{elevPopup.elev != null ? `${elevPopup.elev}m` : "No data"}</div>
          <div className="coords">{elevPopup.lat.toFixed(4)}, {elevPopup.lon.toFixed(4)}</div>
        </div>
      )}

      {/* Status bar */}
      <div className="wv-status">
        {dataStatus.map((ds) => {
          const isActive = state.layers[ds.key as keyof LayerState];
          const indicatorClass = ds.error ? "err" : ds.lastUpdate ? "ok" : isActive ? "loading" : "off";
          return (
            <div key={ds.key} className="wv-status-item">
              <span className={`indicator ${isActive ? indicatorClass : "off"}`} />
              <span>{ds.label}</span>
              {isActive && ds.count > 0 && <span style={{ color: "#555" }}>({ds.count})</span>}
              {isActive && ds.lastUpdate && <span style={{ color: "#444" }}>{fmtTime(ds.lastUpdate)}</span>}
            </div>
          );
        })}
        <span className="wv-status-sep" />
        <span className="wv-coords">{cursorPos ? `${cursorPos[0]}, ${cursorPos[1]}` : "--"}</span>
      </div>
    </div>
  );
}
