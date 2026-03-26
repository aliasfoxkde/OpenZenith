import type { LayerState, DashboardState } from "./types";

export const SIDEBAR_SECTIONS: { title: string; key: string; layerIds: (keyof LayerState)[] }[] = [
  {
    title: "Overlays",
    key: "overlays",
    layerIds: ["hillshade", "elevationColor", "satellite", "blueMarble", "nightLights"],
  },
  {
    title: "Real-Time Data",
    key: "realtime",
    layerIds: ["earthquakes", "radar", "flights", "militaryFlights", "vessels", "warnings", "events", "hurricaneTracks"],
  },
  {
    title: "Space",
    key: "space",
    layerIds: ["satellites", "orbitalTracks", "groundTracks"],
  },
  {
    title: "Infrastructure",
    key: "infrastructure",
    layerIds: ["nlnogNodes", "flightArcs"],
  },
];

export const BASEMAPS: Record<string, { label: string; url: string }> = {
  dark: { label: "Dark", url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png" },
  satellite: { label: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" },
  osm: { label: "OSM", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" },
  voyager: { label: "Voyager", url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png" },
  topo: { label: "Topo", url: "https://tile.opentopomap.org/{z}/{x}/{y}.png" },
};

export const DEFAULT_LAYERS: LayerState = {
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
  orbitalTracks: false,
  groundTracks: false,
};

export const DEFAULT_STATE: DashboardState = {
  center: [0, 20],
  zoom: 2,
  basemap: "dark",
  layers: { ...DEFAULT_LAYERS },
  theme: "default",
  viewMode: "3d",
};

export const THEMES: Record<string, { label: string; icon: string; css: string }> = {
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

export const EONET_COLORS: Record<string, string> = {
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

export const ICONS = {
  flight: `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V18l-8 2.5v2l8-2.5V22l8-2.5v-2l-8 2.5V18l8-2.5z" fill="currentColor"/></svg>`,
  vessel: `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.21-1.66-3.5-2.68H7.5C6.22 18.21 5.21 19.53 4 19.68 2.78 20.53 1.39 21 0 21c2 0 2-2 2-2s0-2 2-2c1.39 0 2.78-.47 4-1.32 1.21-.15 2.22-1.47 3.5-2.68h9c1.28 1.21 2.29 2.53 3.5 2.68 1.22.85 2.61 1.32 4 1.32 2 0 2 2 2 2s0 2-2 2zM12 2l4 4h-3l-1 7H12l-1-7H8l4-4z" fill="currentColor"/></svg>`,
  satellite: `<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="none" stroke="currentColor" stroke-width="1"/><path d="M3.51 9h17M3.51 15h17" fill="none" stroke="currentColor" stroke-width="1" transform="rotate(45 12 12)"/></svg>`,
  eq: `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M16 2L8 22M12 2l8 20M2 12h20" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`,
  storm: `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14l-5-4.87 6.91-1.01z" fill="currentColor"/></svg>`,
};
