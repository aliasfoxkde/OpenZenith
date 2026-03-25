"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface LayerState {
  earthquakes: boolean;
  radar: boolean;
  satellite: boolean;
  flights: boolean;
  warnings: boolean;
  events: boolean;
  satellites: boolean;
  hillshade: boolean;
  terrain3d: boolean;
  hurricaneTracks: boolean;
}

interface DashboardState {
  center: [number, number];
  zoom: number;
  basemap: string;
  layers: LayerState;
  theme: string;
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

const BASEMAPS: Record<string, { label: string; url: string; attr: string }> = {
  dark: { label: "Dark", url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png", attr: "CartoDB" },
  voyager: { label: "Voyager", url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png", attr: "CartoDB" },
  light: { label: "Light", url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png", attr: "CartoDB" },
  osm: { label: "OSM", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "OSM" },
  satellite: { label: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: "Esri" },
  topo: { label: "Topo", url: "https://tile.opentopomap.org/{z}/{x}/{y}.png", attr: "OpenTopoMap" },
};

const DEFAULT_LAYERS: LayerState = {
  earthquakes: true,
  radar: false,
  satellite: false,
  flights: false,
  warnings: false,
  events: true,
  satellites: false,
  hillshade: true,
  terrain3d: false,
  hurricaneTracks: false,
};

const DEFAULT_STATE: DashboardState = {
  center: [0, 20],
  zoom: 2,
  basemap: "dark",
  layers: { ...DEFAULT_LAYERS },
  theme: "default",
};

const THEMES: Record<string, {
  label: string;
  icon: string;
  css: string;
}> = {
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

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function waitForML(timeout = 15000): Promise<any> {
  return new Promise((res, rej) => {
    const w = window as any;
    if (w.maplibregl) return res(w.maplibregl);
    const s = Date.now();
    const iv = setInterval(() => {
      if (w.maplibregl) { clearInterval(iv); res(w.maplibregl); }
      else if (Date.now() - s > timeout) { clearInterval(iv); rej(new Error("MapLibre failed")); }
    }, 100);
  });
}

function elevationToTerrarium(data: Int16Array): Uint8Array {
  const px = new Uint8Array(data.length * 4);
  for (let i = 0; i < data.length; i++) {
    const e = data[i];
    if (e === -32768) { px[i * 4 + 3] = 0; }
    else {
      const h = e + 32768;
      px[i * 4] = (h / 256) | 0;
      px[i * 4 + 1] = h % 256;
      px[i * 4 + 2] = 0;
      px[i * 4 + 3] = 255;
    }
  }
  return px;
}

function parseHash(h: string): Partial<DashboardState> {
  try {
    const p = new URLSearchParams(h.replace(/^#/, ""));
    if (!p.toString()) return {};
    // x/y/z = tile coordinates → compute center from tile
    const tx = p.get("x");
    const ty = p.get("y");
    const tz = p.get("z");
    if (tx && ty && tz) {
      const x = Number(tx), y = Number(ty), z = Number(tz);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z) && z >= 0 && z <= 22) {
        const n = Math.pow(2, z);
        const lng = (x / n) * 360 - 180;
        const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
        const lat = latRad * 180 / Math.PI;
        const layers = p.get("l");
        const activeLayers = layers ? layers.split(",") : [];
        return {
          center: [lng, lat],
          zoom: z,
          basemap: p.get("bm") || undefined,
          theme: p.get("theme") || undefined,
          layers: {
            earthquakes: DEFAULT_LAYERS.earthquakes,
            radar: DEFAULT_LAYERS.radar,
            satellite: DEFAULT_LAYERS.satellite,
            flights: DEFAULT_LAYERS.flights,
            warnings: DEFAULT_LAYERS.warnings,
            events: DEFAULT_LAYERS.events,
            satellites: DEFAULT_LAYERS.satellites,
            hillshade: DEFAULT_LAYERS.hillshade,
            terrain3d: DEFAULT_LAYERS.terrain3d,
            hurricaneTracks: DEFAULT_LAYERS.hurricaneTracks,
            ...Object.fromEntries(activeLayers.map((l) => [l, true])),
          },
        };
      }
    }
    // lng/lat/zoom = center coordinates
    const c = p.get("c");
    const lng = p.get("lng");
    const lat = p.get("lat");
    let center: [number, number] | undefined;
    if (c) {
      const parts = c.split(",").map(Number);
      if (parts.length === 2 && parts.every((n) => !isNaN(n))) center = parts as [number, number];
    } else if (lng && lat) {
      const ln = Number(lng);
      const lt = Number(lat);
      if (!isNaN(ln) && !isNaN(lt)) center = [ln, lt];
    }
    const zoomVal = p.get("zoom");
    const layers = p.get("l");
    const activeLayers = layers ? layers.split(",") : [];
    return {
      center,
      zoom: zoomVal ? Number(zoomVal) : undefined,
      basemap: p.get("bm") || undefined,
      theme: p.get("theme") || undefined,
      layers: {
        earthquakes: DEFAULT_LAYERS.earthquakes,
        radar: DEFAULT_LAYERS.radar,
        satellite: DEFAULT_LAYERS.satellite,
        flights: DEFAULT_LAYERS.flights,
        warnings: DEFAULT_LAYERS.warnings,
        events: DEFAULT_LAYERS.events,
        satellites: DEFAULT_LAYERS.satellites,
        hillshade: DEFAULT_LAYERS.hillshade,
        terrain3d: DEFAULT_LAYERS.terrain3d,
        hurricaneTracks: DEFAULT_LAYERS.hurricaneTracks,
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
  const active = Object.entries(s.layers)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (active.length) p.set("l", active.join(","));
  return "#" + p.toString();
}

function fmtTime(ts: number | null): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/* ═══════════════════════════════════════════════════════════════
   Data fetchers (all client-side)
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
   CSS (inline for zero dependencies)
   ═══════════════════════════════════════════════════════════════ */

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');

/* ── Theme Variables (set via inline style on wrapper) ── */

.wv-wrap{position:relative;width:100vw;height:100vh;overflow:hidden;font-family:var(--font-ui);background:var(--bg-solid);color:var(--text)}

/* ── Scan Lines Overlay ── */
.wv-scanlines{display:var(--scanlines);position:absolute;inset:0;z-index:15;pointer-events:none;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px)}

/* ── Classification Banner ── */
.wv-classification{display:var(--classification-display);position:absolute;top:36px;left:50%;transform:translateX(-50%);z-index:14;pointer-events:none;
  font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing:3px;color:var(--accent);
  background:var(--bg);padding:3px 24px;border:1px solid var(--border);
  text-shadow:0 0 8px var(--accent-glow)}

/* ── Grid Overlay ── */
.wv-grid-overlay{display:var(--grid-display);position:absolute;inset:0;top:36px;z-index:1;pointer-events:none;opacity:0.06;
  background-image:
    linear-gradient(var(--accent) 1px,transparent 1px),
    linear-gradient(90deg,var(--accent) 1px,transparent 1px);
  background-size:60px 60px}

/* ── HUD Corner Brackets ── */
.wv-hud-corners{position:absolute;inset:0;top:36px;z-index:13;pointer-events:none}
.wv-hud-corners::before,.wv-hud-corners::after,
.wv-hud-inner::before,.wv-hud-inner::after{
  content:'';position:absolute;width:var(--corner-size);height:var(--corner-size);border-color:var(--accent);border-style:solid;border-width:0;opacity:0.5}
.wv-hud-corners::before{top:8px;left:8px;border-top-width:2px;border-left-width:2px}
.wv-hud-corners::after{top:8px;right:8px;border-top-width:2px;border-right-width:2px}
.wv-hud-inner::before{bottom:48px;left:8px;border-bottom-width:2px;border-left-width:2px}
.wv-hud-inner::after{bottom:48px;right:8px;border-bottom-width:2px;border-right-width:2px}

/* ── Ticker Bar ── */
.wv-ticker{display:var(--ticker-display);position:absolute;top:36px;left:0;right:0;height:22px;background:var(--bg);border-bottom:1px solid var(--border);z-index:14;overflow:hidden;
  font-family:var(--font-mono);font-size:10px;color:var(--text-muted);line-height:22px}
.wv-ticker-inner{display:inline-block;white-space:nowrap;animation:ticker-scroll 60s linear infinite}
@keyframes ticker-scroll{0%{transform:translateX(100vw)}100%{transform:translateX(-100%)}}

/* ── Base Layout ── */
.wv-map{position:absolute;inset:0;top:36px}
.wv-nav{position:absolute;top:0;left:0;right:0;height:36px;background:var(--bg-nav);backdrop-filter:blur(8px);border-bottom:1px solid var(--border);z-index:20;display:flex;align-items:center;padding:0 12px;gap:1rem}
.wv-nav-brand{color:var(--brand);font-weight:700;font-size:0.9rem;text-decoration:none;letter-spacing:-0.02em;text-shadow:0 0 calc(var(--glow-intensity) * 12px) var(--brand);display:flex;align-items:center;gap:0.4rem}
.wv-nav-links{display:flex;gap:0.75rem;margin-left:auto;align-items:center}
.wv-nav-links a{color:var(--text-muted);font-size:0.75rem;text-decoration:none;transition:color .15s}
.wv-nav-links a:hover{color:var(--text)}
.wv-nav-time{font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);margin-right:0.5rem}

/* ── Theme Switcher ── */
.wv-theme-switcher{position:relative;display:flex;align-items:center}
.wv-theme-btn{width:28px;height:28px;background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;color:var(--text-dim);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.wv-theme-btn:hover{border-color:var(--border-hover);color:var(--text)}
.wv-theme-dropdown{position:absolute;top:34px;right:0;background:var(--bg-solid);border:1px solid var(--border);border-radius:6px;padding:4px;min-width:160px;z-index:100;box-shadow:0 4px 16px rgba(0,0,0,0.5)}
.wv-theme-option{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:11px;color:var(--text-dim);cursor:pointer;border-radius:4px;border:none;background:none;width:100%;text-align:left;transition:all .1s;font-family:var(--font-ui)}
.wv-theme-option:hover{background:var(--bg-hover);color:var(--text)}
.wv-theme-option.active{color:var(--accent)}
.wv-theme-option .swatch{width:12px;height:12px;border-radius:2px;border:1px solid var(--border);flex-shrink:0}

/* ── Sidebar ── */
.wv-sidebar{position:absolute;top:36px;left:0;bottom:40px;width:300px;background:var(--bg);backdrop-filter:blur(12px);border-right:1px solid var(--border);z-index:10;overflow-y:auto;transition:transform .3s ease;display:flex;flex-direction:column}
.wv-sidebar.collapsed{transform:translateX(-300px)}
.wv-sidebar-toggle{position:absolute;top:48px;left:12px;z-index:11;width:36px;height:36px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;transition:left .3s ease}
.wv-sidebar:not(.collapsed)~.wv-sidebar-toggle{left:312px}
.wv-sidebar-header{padding:16px;border-bottom:1px solid var(--border);flex-shrink:0}
.wv-sidebar-header h2{margin:0;font-size:16px;font-weight:600;color:var(--text);letter-spacing:1px}
.wv-sidebar-header p{margin:4px 0 0;font-size:11px;color:var(--text-muted)}
.wv-section{border-bottom:1px solid rgba(255,255,255,0.04);flex-shrink:0}
.wv-section-header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;cursor:pointer;user-select:none;transition:background .1s}
.wv-section-header:hover{background:var(--bg-hover)}
.wv-section-header span{font-size:12px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px}
.wv-section-header .arrow{font-size:10px;color:var(--text-muted2);transition:transform .2s}
.wv-section-header.open .arrow{transform:rotate(90deg)}
.wv-section-body{padding:0 16px 10px;display:none}
.wv-section-body.open{display:block}
.wv-row{display:flex;align-items:center;justify-content:space-between;padding:5px 0}
.wv-row label{font-size:12px;color:var(--text);opacity:0.8;cursor:pointer;display:flex;align-items:center;gap:6px}
.wv-row .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.wv-row input[type=checkbox]{accent-color:var(--accent);width:14px;height:14px;cursor:pointer}
.wv-bm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.wv-bm-btn{padding:6px 4px;font-size:10px;color:var(--text-dim);background:var(--bg-hover);border:1px solid var(--border);border-radius:4px;cursor:pointer;text-align:center;transition:all .15s;font-family:var(--font-ui)}
.wv-bm-btn:hover{border-color:var(--border-hover);color:var(--text)}
.wv-bm-btn.active{background:var(--accent-glow);border-color:var(--accent-active);color:var(--accent-active)}

/* ── Status Bar ── */
.wv-status{position:absolute;bottom:0;left:0;right:0;height:40px;background:var(--bg);backdrop-filter:blur(8px);border-top:1px solid var(--border);z-index:10;display:flex;align-items:center;padding:0 16px;gap:16px;font-size:11px;font-family:var(--font-mono);overflow-x:auto}
.wv-status-item{display:flex;align-items:center;gap:5px;white-space:nowrap;color:var(--text-muted)}
.wv-status-item .indicator{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.wv-status-item .indicator.ok{background:var(--ok);box-shadow:0 0 calc(var(--glow-intensity) * 6px) var(--ok)}
.wv-status-item .indicator.err{background:var(--err);box-shadow:0 0 calc(var(--glow-intensity) * 6px) var(--err)}
.wv-status-item .indicator.loading{background:var(--warn);animation:pulse 1s infinite}
.wv-status-item .indicator.off{background:var(--text-darker)}
.wv-status-sep{width:1px;height:20px;background:var(--border)}
.wv-coords{margin-left:auto;color:var(--text-muted2);font-size:11px}

/* ── Elevation Popup ── */
.wv-elev-popup{position:absolute;z-index:20;background:var(--bg);border:1px solid var(--border-hover);border-radius:4px;padding:8px 12px;font-size:12px;color:var(--text);pointer-events:none;white-space:nowrap;
  box-shadow:0 0 calc(var(--glow-intensity) * 10px) var(--accent-glow)}
.wv-elev-popup .val{font-weight:600;font-size:14px;color:var(--accent)}
.wv-elev-popup .coords{color:var(--text-muted);font-size:10px}

/* ── Context Menu ── */
.wv-ctx-menu button{display:block;width:100%;padding:6px 12px;background:none;border:none;color:var(--text-dim);font-size:0.8rem;text-align:left;cursor:pointer;font-family:var(--font-ui);transition:all .1s}
.wv-ctx-menu button:hover{background:var(--bg-hover);color:var(--text)}

/* ── Animations ── */
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.wv-loading-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg-solid);z-index:30}
.wv-loading-overlay .spinner{width:32px;height:32px;border:3px solid var(--accent-glow);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}

/* ── Blink cursor for classified themes ── */
.wv-blink{animation:blink-cursor 1s step-end infinite}
@keyframes blink-cursor{0%,100%{opacity:1}50%{opacity:0}}

/* ── Glow text effect for HUD themes ── */
.wv-glow{text-shadow:0 0 calc(var(--glow-intensity) * 8px) var(--accent-glow)}

@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:768px){
  .wv-sidebar{width:280px}
  .wv-sidebar:not(.collapsed)~.wv-sidebar-toggle{left:292px}
  .wv-status{font-size:10px;gap:10px}
}
`;

/* ═══════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════ */

export default function WorldViewPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const mlglRef = useRef<any>(null);
  const [state, setState] = useState<DashboardState>(() => {
    if (typeof window === "undefined") return DEFAULT_STATE;
    const parsed = parseHash(window.location.hash);
    let savedTheme: string | null = null;
    try { savedTheme = localStorage.getItem("wv-theme"); } catch { /* tracking prevention */ }
    const clean: Partial<DashboardState> = {};
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const [clock, setClock] = useState("");
  const [loading, setLoading] = useState(true);
  const [cursorPos, setCursorPos] = useState<[number, number] | null>(null);
  const [elevPopup, setElevPopup] = useState<{ x: number; y: number; elev: number | null; lat: number; lon: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; lng: number; lat: number } | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus[]>([
    { key: "earthquakes", label: "Quakes", lastUpdate: null, count: 0, error: null },
    { key: "radar", label: "Radar", lastUpdate: null, count: 0, error: null },
    { key: "satellite", label: "Satellite", lastUpdate: null, count: 0, error: null },
    { key: "flights", label: "Flights", lastUpdate: null, count: 0, error: null },
    { key: "warnings", label: "Warnings", lastUpdate: null, count: 0, error: null },
    { key: "events", label: "Events", lastUpdate: null, count: 0, error: null },
    { key: "satellites", label: "Sats", lastUpdate: null, count: 0, error: null },
    { key: "hurricaneTracks", label: "Storms", lastUpdate: null, count: 0, error: null },
  ]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    basemaps: true, overlays: true, realtime: true, tools: true, theme: false,
  });
  const hashTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const dataLoadedRef = useRef<Record<string, boolean>>({});

  // Sync hash
  useEffect(() => {
    clearTimeout(hashTimeout.current);
    hashTimeout.current = setTimeout(() => {
      window.history.replaceState(null, "", buildHash(state));
    }, 300);
    return () => clearTimeout(hashTimeout.current);
  }, [state]);

  // Clock for HUD themes
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(now.toISOString().replace("T", " ").slice(0, 19) + " UTC");
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, []);

  // Persist theme
  useEffect(() => {
    try { localStorage.setItem("wv-theme", state.theme); } catch { /* tracking prevention */ }
  }, [state.theme]);

  // Update status helper
  const updateStatus = useCallback((key: string, update: Partial<DataStatus>) => {
    setDataStatus((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...update } : s)),
    );
  }, []);

  // ─── Initialize map ───
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    (async () => {
      const mlgl = await waitForML();
      if (destroyed) return;
      mlglRef.current = mlgl;

      const bm = BASEMAPS[state.basemap];
      const map = new mlgl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            basemap: { type: "raster", tiles: [bm.url], tileSize: 256, attribution: bm.attr },
          },
          layers: [
            { id: "basemap", type: "raster", source: "basemap" },
          ],
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        },
        center: state.center,
        zoom: state.zoom,
        maxZoom: 15,
      });

      map.addControl(new mlgl.NavigationControl(), "top-right");
      map.addControl(new mlgl.ScaleControl({ maxWidth: 120 }), "bottom-right");

      // Crosshair cursor
      map.getCanvas().style.cursor = "crosshair";

      map.on("moveend", () => {
        const c = map.getCenter();
        setState((prev) => ({ ...prev, center: [c.lng, c.lat], zoom: map.getZoom() }));
      });

      map.on("mousemove", (e: any) => {
        setCursorPos([e.lngLat.lng, e.lngLat.lat]);
      });

      // Right-click context menu
      map.getCanvas().addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        const rect = map.getCanvas().getBoundingClientRect();
        const point = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
        setCtxMenu({ x: e.clientX, y: e.clientY, lng: point.lng, lat: point.lat });
      });
      map.getCanvas().addEventListener("click", () => setCtxMenu(null), true);
      document.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest(".wv-ctx-menu")) setCtxMenu(null);
      }, true);

      map.on("click", async (e: any) => {
        const { lng, lat } = e.lngLat;
        setCtxMenu(null);
        try {
          const r = await fetch(`/api/elevation?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`);
          const d = await r.json();
          setElevPopup({ x: e.point.x, y: e.point.y, elev: d.elevation, lat, lon: lng });
          setTimeout(() => setElevPopup(null), 4000);
        } catch { /* ignore */ }
      });

      map.on("load", () => {
        if (destroyed) return;

        // Register custom protocol to convert Int16 tiles to terrarium PNG
        mlgl.addProtocol("elevation", async (params: any, callback: any) => {
          const { z, x, y } = params;
          try {
            const res = await fetch(`/api/tile/${z}/${x}/${y}`);
            if (!res.ok) { callback(null, null, null); return { cancel: () => {} }; }
            const buffer = await res.arrayBuffer();
            const int16 = new Int16Array(buffer);
            const terrarium = elevationToTerrarium(int16);
            const canvas = document.createElement("canvas");
            canvas.width = 256; canvas.height = 256;
            const ctx = canvas.getContext("2d")!;
            const img = ctx.createImageData(256, 256);
            img.data.set(terrarium);
            ctx.putImageData(img, 0, 0);
            canvas.toBlob((blob: Blob | null) => {
              if (blob) callback(null, blob, null, null);
              else callback(new Error("Tile encode error"));
            }, "image/png");
            return { cancel: () => {} };
          } catch (err) { callback(err); return { cancel: () => {} }; }
        });

        // Add elevation source and hillshade layer
        map.addSource("elevation", { type: "raster-dem", tiles: ["elevation://{z}/{x}/{y}"], tileSize: 256, maxzoom: 6, encoding: "terrarium" });
        map.addLayer({
          id: "hillshade", type: "hillshade", source: "elevation",
          paint: { "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#333333", "hillshade-exaggeration": 0.3 },
        });

        mapRef.current = map;
        setLoading(false);
      });

      mapRef.current = map;
    })();

    return () => {
      destroyed = true;
      intervalsRef.current.forEach(clearInterval);
      mapRef.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Layer toggling ───
  const toggleLayer = useCallback((key: keyof LayerState) => {
    setState((prev) => {
      const next = { ...prev, layers: { ...prev.layers, [key]: !prev.layers[key] } };
      const map = mapRef.current;
      const mlgl = mlglRef.current;
      if (!map || !mlgl) return next;

      const on = next.layers[key];

      switch (key) {
        case "hillshade":
          if (map.getLayer("hillshade")) map.setLayoutProperty("hillshade", "visibility", on ? "visible" : "none");
          break;

        case "terrain3d":
          if (on) {
            const src = map.getSource("elevation") as any;
            if (src) {
              try { map.setTerrain({ source: "elevation", exaggeration: 1.5 }); } catch { /* not supported */ }
            }
          } else {
            try { map.setTerrain(null); } catch { /* ok */ }
          }
          break;

        case "earthquakes":
          if (on && !dataLoadedRef.current.earthquakes) loadEarthquakes();
          if (!on) {
            ["eq-circles", "eq-labels"].forEach((id) => {
              if (map.getLayer(id)) map.removeLayer(id);
              if (map.getSource(id)) map.removeSource(id);
            });
          }
          break;

        case "radar":
          if (on && !dataLoadedRef.current.radar) loadRadar();
          if (!on) {
            if (map.getLayer("radar")) map.removeLayer("radar");
            if (map.getSource("radar")) map.removeSource("radar");
          }
          break;

        case "satellite":
          if (on) {
            if (!map.getSource("nasa-gibs")) {
              map.addSource("nasa-gibs", {
                type: "raster",
                tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.3.0&LAYER=MODIS_Terra_CorrectedReflectance_TrueColor&TILEMATRIXSET=GoogleMapsCompatible&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&FORMAT=image%2Fpng"],
                tileSize: 256,
                attribution: "NASA GIBS",
              });
              map.addLayer({ id: "nasa-gibs-layer", type: "raster", source: "nasa-gibs", paint: { "raster-opacity": 0.7 } }, "basemap");
            }
          } else {
            if (map.getLayer("nasa-gibs-layer")) map.removeLayer("nasa-gibs-layer");
            if (map.getSource("nasa-gibs")) map.removeSource("nasa-gibs");
          }
          break;

        case "flights":
          if (on && !dataLoadedRef.current.flights) loadFlights();
          if (!on) {
            ["flight-dots"].forEach((id) => {
              if (map.getLayer(id)) map.removeLayer(id);
              if (map.getSource(id)) map.removeSource(id);
            });
          }
          break;

        case "warnings":
          if (on && !dataLoadedRef.current.warnings) loadWarnings();
          if (!on) {
            ["warning-fill", "warning-line"].forEach((id) => {
              if (map.getLayer(id)) map.removeLayer(id);
              if (map.getSource(id)) map.removeSource(id);
            });
          }
          break;

        case "events":
          if (on && !dataLoadedRef.current.events) loadEvents();
          if (!on) {
            ["event-circles", "event-labels"].forEach((id) => {
              if (map.getLayer(id)) map.removeLayer(id);
              if (map.getSource(id)) map.removeSource(id);
            });
          }
          break;

        case "satellites":
          if (on && !dataLoadedRef.current.satellites) loadSatellites();
          if (!on) {
            ["sat-dots"].forEach((id) => {
              if (map.getLayer(id)) map.removeLayer(id);
              if (map.getSource(id)) map.removeSource(id);
            });
          }
          break;

        case "hurricaneTracks":
          if (on && !dataLoadedRef.current.hurricaneTracks) loadHurricanes();
          if (!on) {
            ["storm-lines"].forEach((id) => {
              if (map.getLayer(id)) map.removeLayer(id);
              if (map.getSource(id)) map.removeSource(id);
            });
          }
          break;
      }
      return next;
    });
  }, []);

  // ─── Basemap switch ───
  const switchBasemap = useCallback((key: string) => {
    setState((prev) => ({ ...prev, basemap: key }));
    const map = mapRef.current;
    if (!map) return;
    const bm = BASEMAPS[key];
    const src = map.getSource("basemap") as any;
    if (src) src.setTiles([bm.url]);
  }, []);

  // ─── Section toggle ───
  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ─── Theme switch ───
  const switchTheme = useCallback((key: string) => {
    setState((prev) => ({ ...prev, theme: key }));
    setThemeDropdownOpen(false);
  }, []);

  // ─── Data loaders ───
  const loadEarthquakes = useCallback(async () => {
    updateStatus("earthquakes", { error: null });
    try {
      const data = await fetchEarthquakes();
      const map = mapRef.current;
      if (!map) return;
      const features = data.features || [];
      updateStatus("earthquakes", { lastUpdate: Date.now(), count: features.length });

      const geojson: any = { type: "FeatureCollection", features };
      if (map.getSource("eq-circles")) (map.getSource("eq-circles") as any).setData(geojson);
      else {
        map.addSource("eq-circles", { type: "geojson", data: geojson });
        map.addLayer({
          id: "eq-circles", type: "circle", source: "eq-circles",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 0, 3, 5, 8, 8, 16],
            "circle-color": ["interpolate", ["linear"], ["get", "mag"], 0, "#44ff44", 3, "#ffff00", 5, "#ff8800", 7, "#ff0000"],
            "circle-opacity": 0.7,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff44",
          },
        });
      }
      dataLoadedRef.current.earthquakes = true;

      // Auto-refresh every 60s
      const iv = setInterval(async () => {
        if (!state.layers.earthquakes) return;
        try {
          const d = await fetchEarthquakes();
          (map.getSource("eq-circles") as any)?.setData({ type: "FeatureCollection", features: d.features || [] });
          updateStatus("earthquakes", { lastUpdate: Date.now(), count: (d.features || []).length });
        } catch { /* retry next interval */ }
      }, 60000);
      intervalsRef.current.push(iv);
    } catch (e: any) {
      updateStatus("earthquakes", { error: "fetch failed" });
    }
  }, [updateStatus, state.layers.earthquakes]);

  const loadRadar = useCallback(async () => {
    updateStatus("radar", { error: null });
    try {
      const data = await fetchRainViewer();
      const map = mapRef.current;
      if (!map || !data.radar || !data.radar.past.length) return;
      const latest = data.radar.past[data.radar.past.length - 1];
      updateStatus("radar", { lastUpdate: Date.now(), count: 1 });

      const tileUrl = `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
      if (map.getSource("radar")) (map.getSource("radar") as any).setTiles([tileUrl]);
      else {
        map.addSource("radar", { type: "raster", tiles: [tileUrl], tileSize: 256 });
        map.addLayer({ id: "radar", type: "raster", source: "radar", paint: { "raster-opacity": 0.6 } });
      }
      dataLoadedRef.current.radar = true;

      const iv = setInterval(async () => {
        if (!state.layers.radar) return;
        try {
          const d = await fetchRainViewer();
          const lt = d.radar?.past?.[d.radar.past.length - 1];
          if (lt) {
            const u = `https://tilecache.rainviewer.com${lt.path}/256/{z}/{x}/{y}/2/1_1.png`;
            (map.getSource("radar") as any)?.setTiles([u]);
            updateStatus("radar", { lastUpdate: Date.now(), count: 1 });
          }
        } catch { /* retry */ }
      }, 600000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("radar", { error: "fetch failed" });
    }
  }, [updateStatus, state.layers.radar]);

  const loadEvents = useCallback(async () => {
    updateStatus("events", { error: null });
    try {
      const data = await fetchEONET();
      const map = mapRef.current;
      if (!map) return;
      const features = data.features || [];
      updateStatus("events", { lastUpdate: Date.now(), count: features.length });

      // Color by category
      features.forEach((f: any) => {
        const cat = f.properties?.categories?.[0]?.id || "manmade";
        f.properties._color = EONET_COLORS[cat] || "#888888";
      });

      const geojson: any = { type: "FeatureCollection", features };
      if (map.getSource("event-circles")) (map.getSource("event-circles") as any).setData(geojson);
      else {
        map.addSource("event-circles", { type: "geojson", data: geojson });
        map.addLayer({
          id: "event-circles", type: "circle", source: "event-circles",
          paint: {
            "circle-radius": 6,
            "circle-color": ["get", "_color"],
            "circle-opacity": 0.8,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff66",
          },
        });
      }
      dataLoadedRef.current.events = true;

      const iv = setInterval(async () => {
        if (!state.layers.events) return;
        try {
          const d = await fetchEONET();
          const fs = d.features || [];
          fs.forEach((f: any) => {
            const cat = f.properties?.categories?.[0]?.id || "manmade";
            f.properties._color = EONET_COLORS[cat] || "#888888";
          });
          (map.getSource("event-circles") as any)?.setData({ type: "FeatureCollection", features: fs });
          updateStatus("events", { lastUpdate: Date.now(), count: fs.length });
        } catch { /* retry */ }
      }, 1800000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("events", { error: "fetch failed" });
    }
  }, [updateStatus, state.layers.events]);

  const loadFlights = useCallback(async () => {
    updateStatus("flights", { error: null });
    try {
      const data = await fetchFlights();
      const map = mapRef.current;
      if (!map || !data.states) return;
      updateStatus("flights", { lastUpdate: Date.now(), count: data.states.length });

      // Format: [0:icao24, 1:callsign, 2:country, 3:time_position, 4:last_contact,
      //          5:longitude, 6:latitude, 7:baro_altitude, 8:on_ground, 9:velocity,
      //          10:true_track, 11:vertical_rate, 12:sensors, 13:geo_altitude, 14:squawk,
      //          15:spi, 16:position_source]
      const features = data.states
        .filter((s: any[]) => s[5] != null && s[6] != null)
        .map((s: any[]) => ({
          type: "Feature" as const,
          properties: {
            callsign: (s[1] || "").trim(),
            altitude: s[7],
            speed: s[9],
            heading: s[10],
            country: s[2],
          },
          geometry: { type: "Point" as const, coordinates: [s[5], s[6]] },
        }));

      const geojson: any = { type: "FeatureCollection", features };
      if (map.getSource("flight-dots")) (map.getSource("flight-dots") as any).setData(geojson);
      else {
        map.addSource("flight-dots", { type: "geojson", data: geojson });
        map.addLayer({
          id: "flight-dots", type: "circle", source: "flight-dots",
          paint: {
            "circle-radius": 2.5,
            "circle-color": [
              "interpolate", ["linear"], ["coalesce", ["get", "altitude"], 0],
              0, "#22c55e", 5000, "#eab308", 10000, "#ef4444",
            ],
            "circle-opacity": 0.8,
          },
        });
      }
      dataLoadedRef.current.flights = true;

      const iv = setInterval(async () => {
        if (!state.layers.flights) return;
        try {
          const d = await fetchFlights();
          if (d.states) {
            const fs = d.states.filter((s: any[]) => s[5] != null && s[6] != null).map((s: any[]) => ({
              type: "Feature" as const,
              properties: { callsign: (s[1] || "").trim(), altitude: s[7], speed: s[9], heading: s[10], country: s[2] },
              geometry: { type: "Point" as const, coordinates: [s[5], s[6]] },
            }));
            (map.getSource("flight-dots") as any)?.setData({ type: "FeatureCollection", features: fs });
            updateStatus("flights", { lastUpdate: Date.now(), count: fs.length });
          }
        } catch { /* retry */ }
      }, 15000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("flights", { error: "fetch failed" });
    }
  }, [updateStatus, state.layers.flights]);

  const loadWarnings = useCallback(async () => {
    updateStatus("warnings", { error: null });
    try {
      const data = await fetchWarnings();
      const map = mapRef.current;
      if (!map || !data.features) return;
      updateStatus("warnings", { lastUpdate: Date.now(), count: data.features.length });

      // Color by severity/event type
      data.features.forEach((f: any) => {
        const et = (f.properties?.Event || "").toLowerCase();
        let color = "#eab308"; // default yellow
        if (et.includes("tornado") || et.includes("extreme")) color = "#ef4444";
        else if (et.includes("severe") || et.includes("warning")) color = "#f97316";
        else if (et.includes("watch") || et.includes("advisory")) color = "#eab308";
        f.properties._color = color;
      });

      const geojson: any = { type: "FeatureCollection", features: data.features };
      if (map.getSource("warning-fill")) (map.getSource("warning-fill") as any).setData(geojson);
      else {
        map.addSource("warning-fill", { type: "geojson", data: geojson });
        map.addLayer({
          id: "warning-fill", type: "fill", source: "warning-fill",
          paint: { "fill-color": ["get", "_color"], "fill-opacity": 0.15 },
        });
        map.addLayer({
          id: "warning-line", type: "line", source: "warning-fill",
          paint: { "line-color": ["get", "_color"], "line-width": 1.5, "line-opacity": 0.6 },
        });
      }
      dataLoadedRef.current.warnings = true;

      const iv = setInterval(async () => {
        if (!state.layers.warnings) return;
        try {
          const d = await fetchWarnings();
          if (d.features) {
            d.features.forEach((f: any) => {
              const et = (f.properties?.Event || "").toLowerCase();
              let c = "#eab308";
              if (et.includes("tornado") || et.includes("extreme")) c = "#ef4444";
              else if (et.includes("severe") || et.includes("warning")) c = "#f97316";
              f.properties._color = c;
            });
            (map.getSource("warning-fill") as any)?.setData({ type: "FeatureCollection", features: d.features });
            updateStatus("warnings", { lastUpdate: Date.now(), count: d.features.length });
          }
        } catch { /* retry */ }
      }, 300000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("warnings", { error: "fetch failed" });
    }
  }, [updateStatus, state.layers.warnings]);

  const loadSatellites = useCallback(async () => {
    updateStatus("satellites", { error: null });
    try {
      const tles = await fetchCelestrak();
      const map = mapRef.current;
      if (!map || !Array.isArray(tles)) return;

      // Convert TLE to position using satellite.js if available
      const satJs = (window as any).satellite;
      const now = new Date();

      const features = tles
        .slice(0, 3000) // Limit for performance
        .filter((t: any) => t.TLE_LINE1 && t.TLE_LINE2)
        .map((t: any) => {
          let coords: [number, number] | null = null;
          if (satJs) {
            try {
              const satrec = satJs.twoline2satrec(t.TLE_LINE1, t.TLE_LINE2);
              const pos = satJs.propagate(satrec, now);
              if (pos.position) {
                const gd = satJs.eciToGeodetic(pos.position, satJs.gstime(now));
                coords = [satJs.degreesLong(gd.longitude), satJs.degreesLat(gd.latitude)];
              }
            } catch { /* skip bad TLE */ }
          }
          return {
            type: "Feature" as const,
            properties: { name: t.NAME || t.OBJECT_NAME || "Unknown", norad: t.NORAD_CAT_ID },
            geometry: coords ? { type: "Point" as const, coordinates: coords } : null,
          };
        })
        .filter((f: any) => f.geometry);

      updateStatus("satellites", { lastUpdate: Date.now(), count: features.length });

      const geojson: any = { type: "FeatureCollection", features };
      if (map.getSource("sat-dots")) (map.getSource("sat-dots") as any).setData(geojson);
      else {
        map.addSource("sat-dots", { type: "geojson", data: geojson });
        map.addLayer({
          id: "sat-dots", type: "circle", source: "sat-dots",
          paint: { "circle-radius": 2, "circle-color": "#00ffff", "circle-opacity": 0.5 },
        });
      }
      dataLoadedRef.current.satellites = true;

      const iv = setInterval(async () => {
        if (!state.layers.satellites) return;
        try {
          const t = await fetchCelestrak();
          if (!Array.isArray(t)) return;
          const sj = (window as any).satellite;
          const n = new Date();
          const fs = t.slice(0, 3000).filter((x: any) => x.TLE_LINE1 && x.TLE_LINE2).map((x: any) => {
            let c: [number, number] | null = null;
            if (sj) {
              try {
                const sr = sj.twoline2satrec(x.TLE_LINE1, x.TLE_LINE2);
                const p = sj.propagate(sr, n);
                if (p.position) { const g = sj.eciToGeodetic(p.position, sj.gstime(n)); c = [sj.degreesLong(g.longitude), sj.degreesLat(g.latitude)]; }
              } catch { /* skip */ }
            }
            return { type: "Feature" as const, properties: { name: x.NAME || x.OBJECT_NAME || "", norad: x.NORAD_CAT_ID }, geometry: c ? { type: "Point" as const, coordinates: c } : null };
          }).filter((f: any) => f.geometry);
          (map.getSource("sat-dots") as any)?.setData({ type: "FeatureCollection", features: fs });
          updateStatus("satellites", { lastUpdate: Date.now(), count: fs.length });
        } catch { /* retry */ }
      }, 300000);
      intervalsRef.current.push(iv);
    } catch {
      updateStatus("satellites", { error: "fetch failed" });
    }
  }, [updateStatus, state.layers.satellites]);

  const loadHurricanes = useCallback(async () => {
    updateStatus("hurricaneTracks", { error: null });
    try {
      const csv = await fetchHurricaneTracks();
      const map = mapRef.current;
      if (!map) return;

      const lines = csv.split("\n").slice(1); // skip header
      const storms: Record<string, any[]> = {};

      const CAT_COLORS: Record<string, string> = {
        TS: "#00aaff", Cat1: "#ffff00", Cat2: "#ffcc00", Cat3: "#ff8800", Cat4: "#ff4400", Cat5: "#ff0000",
        SD: "#666666", SS: "#888888", TD: "#aaaaaa", EX: "#cccccc",
      };

      for (const line of lines) {
        const parts = line.split(",");
        if (parts.length < 10) continue;
        const sid = parts[0]?.trim();
        const name = parts[8]?.trim();
        const lat = parseFloat(parts[6]);
        const lon = parseFloat(parts[7]);
        const wind = parseFloat(parts[9]);
        const cat = parts[10]?.trim() || "TS";
        if (isNaN(lat) || isNaN(lon)) continue;

        if (!storms[sid]) storms[sid] = [];
        storms[sid].push({
          coordinates: [lon, lat],
          cat, name, wind,
          color: CAT_COLORS[cat] || "#aaaaaa",
        });
      }

      const features: any[] = [];
      let count = 0;
      for (const [, track] of Object.entries(storms)) {
        if (track.length < 2) continue;
        // Create multi-segment line with color per point
        features.push({
          type: "Feature" as const,
          properties: { name: track[0].name, color: track[track.length - 1].color },
          geometry: {
            type: "LineString" as const,
            coordinates: track.map((p: any) => p.coordinates),
          },
        });
        count++;
      }

      updateStatus("hurricaneTracks", { lastUpdate: Date.now(), count });

      const geojson: any = { type: "FeatureCollection", features };
      if (map.getSource("storm-lines")) (map.getSource("storm-lines") as any).setData(geojson);
      else {
        map.addSource("storm-lines", { type: "geojson", data: geojson });
        map.addLayer({
          id: "storm-lines", type: "line", source: "storm-lines",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 2,
            "line-opacity": 0.7,
          },
        });
      }
      dataLoadedRef.current.hurricaneTracks = true;
    } catch {
      updateStatus("hurricaneTracks", { error: "fetch failed" });
    }
  }, [updateStatus]);

  // ─── Load initial layers on mount ───
  useEffect(() => {
    if (!loading) {
      if (state.layers.earthquakes) loadEarthquakes();
      if (state.layers.events) loadEvents();
      // Don't auto-load heavy layers (flights, radar, etc.) - user toggles them
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
        <div className="wv-loading-overlay">
          <div className="spinner" />
        </div>
      )}

      {/* Scan lines */}
      <div className="wv-scanlines" />

      {/* Grid overlay */}
      <div className="wv-grid-overlay" />

      {/* HUD corners */}
      <div className="wv-hud-corners"><div className="wv-hud-inner" /></div>

      {/* Classification banner */}
      {isHud && (
        <div className="wv-classification">
          {state.theme === "classified" ? "TOP SECRET // SCI" : "RESTRICTED // OPERATIONAL"}
          <span className="wv-blink" style={{ marginLeft: 12, fontSize: 9, opacity: 0.5 }}>●</span>
        </div>
      )}

      {/* Ticker bar */}
      {isHud && (
        <div className="wv-ticker">
          <div className="wv-ticker-inner">
            SIGINT FEED ACTIVE ◆ GEOSPATIAL INTEL COLLECTION IN PROGRESS ◆ ALL SOURCES NOMINAL ◆
            {dataStatus.filter(d => d.lastUpdate).map(d => `${d.label.toUpperCase()}: ${d.count} OBJECTS`).join(" ◆ ")} ◆
            LAT {cursorPos ? cursorPos[1].toFixed(4) : "----"} LON {cursorPos ? cursorPos[0].toFixed(4) : "----"} ◆
            ZOOM {state.zoom.toFixed(1)} ◆ {clock}
          </div>
        </div>
      )}

      {/* Nav bar */}
      <div className="wv-nav">
        <a href="/" className="wv-nav-brand">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <path d="M16 2L28 28H4L16 2Z" fill="#22c55e" opacity="0.9" />
            <path d="M16 2L22 15H10L16 2Z" fill="#22c55e" opacity="0.5" />
            <path d="M4 28L16 18L28 28H4Z" fill="#22c55e" opacity="0.3" />
          </svg>
          OpenZenith
          {!isHud && <span style={{ color: "var(--text-muted2)", fontWeight: 400, fontSize: "0.75rem", marginLeft: 4 }}>/ WorldView</span>}
          {isHud && <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: "0.7rem", marginLeft: 4 }}>// WV</span>}
        </a>
        {isHud && <span className="wv-nav-time">{clock}</span>}
        <div className="wv-nav-links">
          <a href="/">Home</a>
          <a href="/map">Map</a>
          <a href="/explore">Explore</a>
          <a href="/api/docs">Docs</a>

          {/* Theme switcher */}
          <div className="wv-theme-switcher">
            <button className="wv-theme-btn" onClick={() => setThemeDropdownOpen(!themeDropdownOpen)} title="Change theme">
              {currentTheme.icon}
            </button>
            {themeDropdownOpen && (
              <div className="wv-theme-dropdown">
                {Object.entries(THEMES).map(([k, v]) => (
                  <button
                    key={k}
                    className={`wv-theme-option ${state.theme === k ? "active" : ""}`}
                    onClick={() => switchTheme(k)}
                  >
                    <span className="swatch" style={{
                      background: k === "default" ? "#4a9eff" : k === "classified" ? "#00ff41" : k === "amber" ? "#ffb000" : k === "arctic" ? "#00ccff" : "#ff2222",
                    }} />
                    {v.icon} {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="wv-map" />

      {/* Sidebar */}
      <div className={`wv-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="wv-sidebar-header">
          <h2 className={isHud ? "wv-glow" : ""}>{isHud ? "◆ " : ""}WORLDVIEW</h2>
          <p>{isHud ? "GEOINT ANALYSIS TERMINAL" : "Real-Time Geospatial Intelligence"}</p>
        </div>

        {/* Basemaps */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.basemaps ? "open" : ""}`} onClick={() => toggleSection("basemaps")}>
            <span>Basemaps</span>
            <span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.basemaps ? "open" : ""}`}>
            <div className="wv-bm-grid">
              {Object.entries(BASEMAPS).map(([k, v]) => (
                <button key={k} className={`wv-bm-btn ${state.basemap === k ? "active" : ""}`} onClick={() => switchBasemap(k)}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Overlays */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.overlays ? "open" : ""}`} onClick={() => toggleSection("overlays")}>
            <span>Overlays</span>
            <span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.overlays ? "open" : ""}`}>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#4a9eff" }} />Hillshade</label>
              <input type="checkbox" checked={state.layers.hillshade} onChange={() => toggleLayer("hillshade")} />
            </div>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#8b5cf6" }} />3D Terrain</label>
              <input type="checkbox" checked={state.layers.terrain3d} onChange={() => toggleLayer("terrain3d")} />
            </div>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#22d3ee" }} />NASA Satellite</label>
              <input type="checkbox" checked={state.layers.satellite} onChange={() => toggleLayer("satellite")} />
            </div>
          </div>
        </div>

        {/* Real-Time Data */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.realtime ? "open" : ""}`} onClick={() => toggleSection("realtime")}>
            <span>Real-Time Data</span>
            <span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.realtime ? "open" : ""}`}>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#ff4444" }} />Earthquakes</label>
              <input type="checkbox" checked={state.layers.earthquakes} onChange={() => toggleLayer("earthquakes")} />
            </div>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#3b82f6" }} />Weather Radar</label>
              <input type="checkbox" checked={state.layers.radar} onChange={() => toggleLayer("radar")} />
            </div>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#22c55e" }} />Flights (ADS-B)</label>
              <input type="checkbox" checked={state.layers.flights} onChange={() => toggleLayer("flights")} />
            </div>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#f97316" }} />Weather Warnings</label>
              <input type="checkbox" checked={state.layers.warnings} onChange={() => toggleLayer("warnings")} />
            </div>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#a855f7" }} />Natural Events</label>
              <input type="checkbox" checked={state.layers.events} onChange={() => toggleLayer("events")} />
            </div>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#00ffff" }} />Satellites</label>
              <input type="checkbox" checked={state.layers.satellites} onChange={() => toggleLayer("satellites")} />
            </div>
            <div className="wv-row">
              <label><span className="dot" style={{ background: "#ff00ff" }} />Hurricane Tracks</label>
              <input type="checkbox" checked={state.layers.hurricaneTracks} onChange={() => toggleLayer("hurricaneTracks")} />
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.tools ? "open" : ""}`} onClick={() => toggleSection("tools")}>
            <span>Tools</span>
            <span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.tools ? "open" : ""}`}>
            <div className="wv-row">
              <label style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                Click map for elevation query
              </label>
            </div>
            <div className="wv-row">
              <label style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                Data sources: USGS, RainViewer, NASA, OpenSky, NOAA, Celestrak
              </label>
            </div>
          </div>
        </div>

        {/* Theme */}
        <div className="wv-section">
          <div className={`wv-section-header ${openSections.theme ? "open" : ""}`} onClick={() => toggleSection("theme")}>
            <span>Theme</span>
            <span className="arrow">&#9654;</span>
          </div>
          <div className={`wv-section-body ${openSections.theme ? "open" : ""}`}>
            <div className="wv-bm-grid">
              {Object.entries(THEMES).map(([k, v]) => (
                <button
                  key={k}
                  className={`wv-bm-btn ${state.theme === k ? "active" : ""}`}
                  onClick={() => switchTheme(k)}
                >
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar toggle */}
      <button className="wv-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? "\u2715" : "\u2630"}
      </button>

      {/* Close theme dropdown on outside click */}
      {themeDropdownOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setThemeDropdownOpen(false)} />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="wv-ctx-menu"
          style={{
            position: "fixed", top: ctxMenu.y, left: ctxMenu.x, zIndex: 200,
            background: "var(--bg-solid)", border: "1px solid var(--border-hover)", borderRadius: 6,
            padding: "4px 0", minWidth: 190, boxShadow: "0 4px 12px rgba(0,0,0,0.5)", backdropFilter: "blur(8px)",
          }}
        >
          <button onClick={() => { navigator.clipboard.writeText(`${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`); setCtxMenu(null); }}>
            Copy coordinates
          </button>
          <button onClick={() => { navigator.clipboard.writeText(`${ctxMenu.lat.toFixed(6)},${ctxMenu.lng.toFixed(6)}`); setCtxMenu(null); }}>
            Copy compact
          </button>
          <button onClick={() => {
            const toDms = (d: number, pos: string, neg: string) => {
              const dir = d >= 0 ? pos : neg;
              const a = Math.abs(d);
              const deg = Math.floor(a);
              const min = Math.floor((a - deg) * 60);
              const sec = ((a - deg - min / 60) * 3600).toFixed(2);
              return `${deg}\u00b0${min}'${sec}"${dir}`;
            };
            navigator.clipboard.writeText(`${toDms(ctxMenu.lat, "N", "S")} ${toDms(ctxMenu.lng, "E", "W")}`);
            setCtxMenu(null);
          }}>
            Copy DMS
          </button>
          <button onClick={() => { navigator.clipboard.writeText(`${ctxMenu.lng.toFixed(6)},${ctxMenu.lat.toFixed(6)}`); setCtxMenu(null); }}>
            Copy lng,lat
          </button>
          <button onClick={() => { navigator.clipboard.writeText(`${ctxMenu.lat.toFixed(6)},${ctxMenu.lng.toFixed(6)}`); setCtxMenu(null); }}>
            Copy lat,lng
          </button>
          <button onClick={() => { window.open(`https://www.openstreetmap.org/?mlat=${ctxMenu.lat}&mlon=${ctxMenu.lng}#map=17/${ctxMenu.lat}/${ctxMenu.lng}`, "_blank"); setCtxMenu(null); }}
            style={{ color: "var(--accent)" }}>
            Open in OSM
          </button>
          <button onClick={async () => {
            try {
              const r = await fetch(`/api/elevation?lat=${ctxMenu.lat.toFixed(6)}&lon=${ctxMenu.lng.toFixed(6)}`);
              const d = await r.json();
              navigator.clipboard.writeText(`${d.elevation !== null ? d.elevation + "m" : "No data"} @ ${ctxMenu.lat.toFixed(6)}, ${ctxMenu.lng.toFixed(6)}`);
            } catch { /* ignore */ }
            setCtxMenu(null);
          }}
            style={{ color: "var(--ok)" }}>
            Copy elevation
          </button>
        </div>
      )}

      {/* Elevation popup */}
      {elevPopup && (
        <div
          className="wv-elev-popup"
          style={{ left: elevPopup.x + 16, top: elevPopup.y - 10 }}
        >
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
        <span className="wv-coords">
          {cursorPos ? `${cursorPos[0].toFixed(3)}, ${cursorPos[1].toFixed(3)}` : "--"}
        </span>
      </div>
    </div>
  );
}
