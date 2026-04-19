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
    dataSource: "/api/elevation-color/{z}/{x}/{y}",
  },
  {
    id: "elevationAccuracy",
    name: "Data Accuracy",
    category: "terrain",
    description:
      "Shows resolution of elevation sources: 2m (cyan) / 10m (green) / 30m (dark green) / 450m ocean (blue)",
    defaultEnabled: true,
    accent: "#38bdf8",
    dataSource: "/api/elevation-accuracy/{z}/{x}/{y}",
  },
  {
    id: "contours",
    name: "Topo Contours",
    category: "terrain",
    description: "Topographic contour lines with major (500m) and minor (100m) intervals",
    defaultEnabled: false,
    accent: "#94a3b8",
    dataSource: "/api/contours/{z}/{x}/{y}",
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
    id: "vessels",
    name: "Vessels (AIS)",
    category: "maritime",
    description: "Real-time ship positions from AISstream.io (requires API key)",
    defaultEnabled: false,
    accent: "#00e5ff",
    dataSource: "/api/vessels",
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
  {
    id: "buildings",
    name: "Building Footprints",
    category: "infrastructure",
    description: "Global building footprints from Overture Maps Foundation (Microsoft + OSM)",
    defaultEnabled: false,
    accent: "#d4c5a9",
    dataSource: "https://tiles.overturemaps.org/",
  },
  {
    id: "populationDensity",
    name: "Population Density",
    category: "infrastructure",
    description: "Global population density from JRC GHSL (2025, 100m resolution)",
    defaultEnabled: false,
    accent: "#fbbf24",
    dataSource: "/api/population/{z}/{x}/{y}",
  },
  {
    id: "landCover",
    name: "Land Cover",
    category: "infrastructure",
    description: "CORINE Land Cover 2018 — European land use classification (44 classes, 100m)",
    defaultEnabled: false,
    accent: "#22c55e",
    dataSource: "/api/landcover/{z}/{x}/{y}",
  },
  {
    id: "sentinel2",
    name: "Satellite Imagery",
    category: "imagery",
    description: "Sentinel-2 recent satellite imagery via Planetary Computer (10m resolution)",
    defaultEnabled: false,
    accent: "#a78bfa",
    dataSource: "/api/sentinel2/{z}/{x}/{y}",
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

  /* ── Space Weather ────────────────────────────────────── */
  {
    id: "spaceWeather",
    name: "Space Weather",
    category: "weather",
    description: "NOAA SWPC aurora forecast, Kp index, geomagnetic storm alerts",
    defaultEnabled: false,
    accent: "#00ff88",
    dataSource: "https://services.swpc.noaa.gov/json/ovation_aurora_forecast_map.json",
  },

  /* ── Air Quality ──────────────────────────────────────── */
  {
    id: "airQuality",
    name: "Air Quality",
    category: "weather",
    description: "Global AQI, PM2.5, PM10, NO₂, O₃ from Open-Meteo Air Quality API",
    defaultEnabled: false,
    accent: "#22c55e",
    dataSource: "https://air-quality-api.open-meteo.com/v1/air-quality",
  },

  /* ── Aviation Weather ─────────────────────────────────── */
  {
    id: "aviationWeather",
    name: "SIGMETs / AIRMETs",
    category: "aviation",
    description: "NOAA Aviation Weather Center — significant meteorological information and airmets",
    defaultEnabled: false,
    accent: "#ef4444",
    dataSource: "https://aviationweather.gov/api/data/sigmet?format=json",
  },

  /* ── Volcanoes ────────────────────────────────────────── */
  {
    id: "volcanoes",
    name: "Volcano Alerts",
    category: "weather",
    description: "USGS real-time volcano alert status (advisory, watch, warning)",
    defaultEnabled: false,
    accent: "#ff4444",
    dataSource: "https://volcanoes.usgs.gov/feed/v0.1/all.geojson",
  },

  /* ── Disasters ────────────────────────────────────────── */
  {
    id: "gdacs",
    name: "Disaster Alerts",
    category: "weather",
    description: "GDACS global disaster aggregation — earthquakes, cyclones, floods, volcanoes",
    defaultEnabled: false,
    accent: "#f59e0b",
    dataSource: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/ATOM",
  },

  /* ── Marine Weather ───────────────────────────────────── */
  {
    id: "marineWeather",
    name: "Marine Weather",
    category: "maritime",
    description: "Global wave height, SST, wind waves from Open-Meteo Marine API",
    defaultEnabled: false,
    accent: "#0ea5e9",
    dataSource: "https://marine-api.open-meteo.com/v1/marine",
  },

  /* ── Wildfires ────────────────────────────────────────── */
  {
    id: "wildfires",
    name: "Wildfires",
    category: "weather",
    description: "NASA FIRMS active fire/hotspot detection (VIIRS satellite)",
    defaultEnabled: false,
    accent: "#ff6600",
    dataSource: "https://firms.modaps.eosdis.nasa.gov/api/area/",
  },

  /* ── Environmental / SAR ────────────────────────────── */
  {
    id: "floods",
    name: "Flood Extent",
    category: "weather",
    description: "Copernicus EMS / GLOFAS flood monitoring and river flood forecasts",
    defaultEnabled: false,
    accent: "#3b82f6",
    dataSource: "https://floods.jrc.ec.europa.eu/",
  },
  {
    id: "seaIce",
    name: "Sea Ice",
    category: "weather",
    description: "Sea ice concentration from NSIDC and OSI SAF satellite observations",
    defaultEnabled: false,
    accent: "#93c5fd",
    dataSource: "https://nsidc.org/",
  },

  /* ── Lightning ────────────────────────────────────────── */
  {
    id: "lightning",
    name: "Lightning",
    category: "weather",
    description: "Real-time global lightning strikes from Blitzortung.org",
    defaultEnabled: false,
    accent: "#fbbf24",
    dataSource: "wss://ws.blitzortung.org:443/",
  },

  {
    id: "orbitalTracks",
    name: "Orbital Tracks",
    category: "space",
    description: "Satellite orbital paths with glow trails for ISS, Hubble, Starlink, GPS",
    defaultEnabled: false,
    accent: "#00e5ff",
    dataSource: "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json",
  },
  {
    id: "groundTracks",
    name: "Ground Tracks",
    category: "space",
    description: "Satellite ground track projections on Earth surface",
    defaultEnabled: false,
    accent: "#00b8d4",
    dataSource: "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json",
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
  "maritime",
  "infrastructure",
  "hydro",
  "terrain",
  "imagery",
  "space",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  weather: "Weather",
  aviation: "Aviation",
  maritime: "Maritime",
  infrastructure: "Infrastructure",
  hydro: "Hydrography",
  terrain: "Terrain",
  imagery: "Imagery",
  space: "Space",
};
