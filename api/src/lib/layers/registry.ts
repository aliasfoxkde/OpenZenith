/**
 * Shared layer registry for Map (2D/MapLibre) and Globe (3D/CesiumJS).
 *
 * Each layer definition is a self-contained object with metadata and optional
 * render/remove functions for both MapLibre and CesiumJS.
 *
 * Consumers (Map page, Globe page) pick which layers to offer and call
 * renderMapLibre/renderCesium to activate them.
 */

import type { LayerDefinition, LayerToggleState } from "./types";

/* ═══════════════════════════════════════════════════════════════
   Layer definitions
   ═══════════════════════════════════════════════════════════════ */

export const LAYERS: readonly LayerDefinition[] = [
  /* ── Terrain ──────────────────────────────────────────── */
  {
    id: "hillshade",
    name: "Hillshade",
    category: "terrain",
    description: "Terrain hillshade shading derived from SRTM 30m elevation data",
    defaultEnabled: true,
    accent: "#8b7355",
    dataSource: "/api/tile/{z}/{x}/{y}",
  },
  {
    id: "elevationColor",
    name: "Elevation Color",
    category: "terrain",
    description: "Color-coded elevation overlay from sea level to mountain peaks",
    defaultEnabled: false,
    accent: "#22c55e",
    dataSource: "/api/tile/{z}/{x}/{y}",
  },
  {
    id: "bathymetry",
    name: "Bathymetry",
    category: "terrain",
    description: "Ocean depth shading from GEBCO 2024 data",
    defaultEnabled: false,
    accent: "#3b82f6",
    dataSource: "/api/bathymetry",
  },

  /* ── Weather ──────────────────────────────────────────── */
  {
    id: "earthquakes",
    name: "Earthquakes",
    category: "weather",
    description: "Real-time earthquake data from USGS (magnitude, depth, location)",
    defaultEnabled: true,
    accent: "#ef4444",
    dataSource: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
  },
  {
    id: "radar",
    name: "Weather Radar",
    category: "weather",
    description: "NEXRAD weather radar mosaic from RainViewer",
    defaultEnabled: false,
    accent: "#22c55e",
    dataSource: "https://api.rainviewer.com/public/weather-maps.json",
  },
  {
    id: "warnings",
    name: "Weather Warnings",
    category: "weather",
    description: "NWS watches, warnings, and advisories (US only)",
    defaultEnabled: false,
    accent: "#f59e0b",
    dataSource: "/api/weather/warnings",
  },
  {
    id: "hurricaneTracks",
    name: "Hurricane Tracks",
    category: "weather",
    description: "Active tropical cyclone tracks and forecast cones",
    defaultEnabled: false,
    accent: "#f97316",
    dataSource: "https://www.nhc.noaa.gov/CurrentStorms.json",
  },

  /* ── Aviation ─────────────────────────────────────────── */
  {
    id: "flights",
    name: "Flights (ADS-B)",
    category: "aviation",
    description: "Real-time commercial flight positions from OpenSky Network",
    defaultEnabled: false,
    accent: "#00e5ff",
    dataSource: "/api/flights",
  },
  {
    id: "militaryFlights",
    name: "Military ADS-B",
    category: "aviation",
    description: "Military aircraft transponder data from ADS-B Exchange",
    defaultEnabled: false,
    accent: "#a855f7",
    dataSource: "/api/flights?military=true",
  },
  {
    id: "flightArcs",
    name: "Flight Arcs",
    category: "aviation",
    description: "Animated arcs showing flight routes between airports",
    defaultEnabled: false,
    accent: "#38bdf8",
    dataSource: "/api/flights",
  },

  /* ── Infrastructure ───────────────────────────────────── */
  {
    id: "nlnogNodes",
    name: "NLNOG Nodes",
    category: "infrastructure",
    description: "NLNOG Ring measurement nodes worldwide",
    defaultEnabled: false,
    accent: "#f97316",
    dataSource: "/api/nlnog",
  },

  /* ── Hydro ────────────────────────────────────────────── */
  {
    id: "waterways",
    name: "Waterways",
    category: "hydro",
    description: "Rivers, lakes, and water features from HydroSHEDS and OSM",
    defaultEnabled: false,
    accent: "#38bdf8",
    dataSource: "/api/waterways",
  },

  /* ── Imagery ──────────────────────────────────────────── */
  {
    id: "blueMarble",
    name: "Blue Marble",
    category: "imagery",
    description: "NASA Blue Marble true-color imagery",
    defaultEnabled: false,
    accent: "#60a5fa",
  },
  {
    id: "nightLights",
    name: "Night Lights",
    category: "imagery",
    description: "NASA VIIRS city lights imagery (Black Marble)",
    defaultEnabled: false,
    accent: "#fbbf24",
  },
  {
    id: "satellite",
    name: "Satellite",
    category: "imagery",
    description: "GOES-East weather satellite imagery",
    defaultEnabled: false,
    accent: "#a78bfa",
  },

  /* ── Space ────────────────────────────────────────────── */
  {
    id: "satellites",
    name: "Satellites",
    category: "space",
    description: "Tracked satellites in orbit from Celestrak",
    defaultEnabled: false,
    accent: "#e2e8f0",
    dataSource: "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
  },
  {
    id: "events",
    name: "Natural Events",
    category: "space",
    description: "NASA EONET natural events (volcanoes, wildfires, icebergs)",
    defaultEnabled: true,
    accent: "#ef4444",
    dataSource: "https://eonet.gsfc.nasa.gov/api/v3/events",
  },
];

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

/** Get a layer definition by ID. */
export function getLayer(id: string): LayerDefinition | undefined {
  return LAYERS.find((l) => l.id === id);
}

/** Get layers grouped by category. */
export function getLayersByCategory(): Record<string, LayerDefinition[]> {
  const groups: Record<string, LayerDefinition[]> = {};
  for (const layer of LAYERS) {
    (groups[layer.category] ??= []).push(layer);
  }
  return groups;
}

/** Build initial toggle state from layer defaults. */
export function getDefaultToggleState(): LayerToggleState {
  const state: LayerToggleState = {};
  for (const layer of LAYERS) {
    state[layer.id] = layer.defaultEnabled;
  }
  return state;
}

/** Ordered category labels for sidebar rendering. */
export const CATEGORY_ORDER = [
  "weather",
  "aviation",
  "infrastructure",
  "hydro",
  "terrain",
  "imagery",
  "space",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  weather: "Weather",
  aviation: "Aviation",
  infrastructure: "Infrastructure",
  hydro: "Hydrography",
  terrain: "Terrain",
  imagery: "Imagery",
  space: "Space",
};
