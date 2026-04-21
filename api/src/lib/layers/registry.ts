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
  /* ── Hillshade — top of list, loaded last on map ──── */
  {
    id: "hillshade",
    name: "Hillshade",
    category: "hillshade",
    description: "Terrain hillshade shading derived from SRTM 30m elevation data",
    defaultEnabled: true,
    accent: "#8b7355",
    dataSource: "/api/tile/{z}/{x}/{y}",
  },
  /* ── Terrain ──────────────────────────────────────────── */
  {
    id: "elevationColor",
    name: "Elevation Color",
    category: "terrain",
    description: "Color-coded elevation overlay from sea level to mountain peaks",
    defaultEnabled: true,
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
    defaultEnabled: true,
    accent: "#3b82f6",
    dataSource: "/api/bathymetry",
  },
  {
    id: "equator",
    name: "Equator Line",
    category: "terrain",
    description: "Reference line at 0 degrees latitude",
    defaultEnabled: true,
    accent: "#94a3b8",
  },
  /* ── Weather ──────────────────────────────────────────── */
  {
    id: "earthquakes",
    name: "Earthquakes",
    category: "hazards",
    description: "Real-time earthquake data from USGS (magnitude, depth, location)",
    defaultEnabled: false,
    accent: "#ef4444",
    dataSource: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
  },
  {
    id: "radar",
    name: "Weather Radar",
    category: "atmosphere",
    description: "NEXRAD weather radar mosaic from RainViewer",
    defaultEnabled: true,
    accent: "#22c55e",
    dataSource: "https://api.rainviewer.com/public/weather-maps.json",
  },
  {
    id: "warnings",
    name: "Weather Warnings",
    category: "atmosphere",
    description: "NWS watches, warnings, and advisories (US only)",
    defaultEnabled: false,
    accent: "#f59e0b",
    dataSource: "/api/weather/warnings",
  },
  {
    id: "hurricaneTracks",
    name: "Hurricane Tracks",
    category: "hazards",
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
    category: "ocean",
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
    defaultEnabled: false,
    accent: "#ef4444",
    dataSource: "https://eonet.gsfc.nasa.gov/api/v3/events",
  },

  /* ── Space Weather ────────────────────────────────────── */
  {
    id: "spaceWeather",
    name: "Space Weather",
    category: "atmosphere",
    description: "NOAA SWPC aurora forecast, Kp index, geomagnetic storm alerts",
    defaultEnabled: false,
    accent: "#00ff88",
    dataSource: "https://services.swpc.noaa.gov/json/ovation_aurora_forecast_map.json",
  },

  /* ── Air Quality ──────────────────────────────────────── */
  {
    id: "airQuality",
    name: "Air Quality",
    category: "atmosphere",
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
    category: "hazards",
    description: "USGS real-time volcano alert status (advisory, watch, warning)",
    defaultEnabled: false,
    accent: "#ff4444",
    dataSource: "https://volcanoes.usgs.gov/feed/v0.1/all.geojson",
  },

  /* ── Disasters ────────────────────────────────────────── */
  {
    id: "gdacs",
    name: "Disaster Alerts",
    category: "hazards",
    description: "GDACS global disaster aggregation — earthquakes, cyclones, floods, volcanoes",
    defaultEnabled: false,
    accent: "#f59e0b",
    dataSource: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/ATOM",
  },

  /* ── Marine Weather ───────────────────────────────────── */
  {
    id: "marineWeather",
    name: "Marine Weather",
    category: "ocean",
    description: "Global wave height, SST, wind waves from Open-Meteo Marine API",
    defaultEnabled: false,
    accent: "#0ea5e9",
    dataSource: "https://marine-api.open-meteo.com/v1/marine",
  },

  /* ── Wildfires ────────────────────────────────────────── */
  {
    id: "wildfires",
    name: "Wildfires",
    category: "hazards",
    description: "NASA FIRMS active fire/hotspot detection (VIIRS satellite)",
    defaultEnabled: false,
    accent: "#ff6600",
    dataSource: "https://firms.modaps.eosdis.nasa.gov/api/area/",
  },

  /* ── Environmental / SAR ────────────────────────────── */
  {
    id: "floods",
    name: "Flood Extent",
    category: "hazards",
    description: "VIIRS satellite flood detection (NASA GIBS, 3-day composite)",
    defaultEnabled: false,
    accent: "#3b82f6",
    dataSource: "/api/floods-tile/{z}/{x}/{y}",
  },
  {
    id: "fireTemperature",
    name: "Fire Temperature",
    category: "hazards",
    description: "GOES-16 thermal fire detection — real-time hotspot imagery from geostationary satellite",
    defaultEnabled: false,
    accent: "#ff2200",
    dataSource: "/api/fire-temperature/{z}/{x}/{y}",
  },
  {
    id: "sarBackscatter",
    name: "SAR Backscatter",
    category: "imagery",
    description: "Sentinel-1 synthetic aperture radar imagery via NASA OPERA (VV/VH polarization)",
    defaultEnabled: false,
    accent: "#94a3b8",
    dataSource: "/api/sar-backscatter/{z}/{x}/{y}",
  },
  {
    id: "dynamicSurfaceWater",
    name: "Surface Water",
    category: "hazards",
    description: "OPERA L3 dynamic surface water extent from Sentinel-1 SAR (flooding, seasonal change)",
    defaultEnabled: false,
    accent: "#2563eb",
    dataSource: "/api/dynamic-surface-water/{z}/{x}/{y}",
  },
  {
    id: "disturbanceAlerts",
    name: "Disturbance Alerts",
    category: "hazards",
    description: "OPERA L3 HLS disturbance detection — fire, deforestation, urbanization alerts",
    defaultEnabled: false,
    accent: "#dc2626",
    dataSource: "/api/disturbance-alerts/{z}/{x}/{y}",
  },
  {
    id: "so2Volcanic",
    name: "SO₂ Volcanic",
    category: "atmosphere",
    description: "TROPOMI sulfur dioxide monitoring for volcanic eruption detection and aviation safety",
    defaultEnabled: false,
    accent: "#a855f7",
    dataSource: "/api/so2-volcanic/{z}/{x}/{y}",
  },
  {
    id: "no2Pollution",
    name: "NO₂ Pollution",
    category: "atmosphere",
    description: "TROPOMI tropospheric NO₂ — tracks industrial, traffic, and wildfire pollution",
    defaultEnabled: false,
    accent: "#eab308",
    dataSource: "/api/no2-pollution/{z}/{x}/{y}",
  },
  {
    id: "precipitation",
    name: "Precipitation",
    category: "atmosphere",
    description: "IMERG global precipitation rate from GPM satellite constellation",
    defaultEnabled: false,
    accent: "#3b82f6",
    dataSource: "/api/precipitation/{z}/{x}/{y}",
  },
  {
    id: "soilMoisture",
    name: "Soil Moisture",
    category: "atmosphere",
    description: "SMAP L-band radar soil moisture for drought and flood risk monitoring",
    defaultEnabled: false,
    accent: "#854d0e",
    dataSource: "/api/soil-moisture/{z}/{x}/{y}",
  },
  {
    id: "ndvi",
    name: "NDVI Vegetation",
    category: "imagery",
    description: "MODIS Terra 16-day NDVI composite — vegetation health, drought, deforestation monitoring",
    defaultEnabled: false,
    accent: "#16a34a",
    dataSource: "/api/ndvi/{z}/{x}/{y}",
  },

  /* ── Ocean & Climate ────────────────────────────────── */
  {
    id: "sst",
    name: "Sea Surface Temp",
    category: "ocean",
    description: "GHRSST L4 MUR sea surface temperature — ocean thermal patterns and currents",
    defaultEnabled: false,
    accent: "#ef4444",
    dataSource: "/api/sst/{z}/{x}/{y}",
  },
  {
    id: "chlorophyll",
    name: "Chlorophyll-a",
    category: "ocean",
    description: "MODIS Aqua ocean chlorophyll concentration — phytoplankton blooms, marine productivity",
    defaultEnabled: false,
    accent: "#22c55e",
    dataSource: "/api/chlorophyll/{z}/{x}/{y}",
  },
  {
    id: "snowCover",
    name: "Snow Cover",
    category: "atmosphere",
    description: "MODIS Terra 8-day snow extent — global snow and ice coverage monitoring",
    defaultEnabled: false,
    accent: "#e0f2fe",
    dataSource: "/api/snow-cover/{z}/{x}/{y}",
  },
  {
    id: "canopyHeight",
    name: "Canopy Height",
    category: "infrastructure",
    description: "GEDI ISS L3 mean canopy height — global forest structure from spaceborne lidar",
    defaultEnabled: false,
    accent: "#15803d",
    dataSource: "/api/canopy-height/{z}/{x}/{y}",
  },
  {
    id: "biomass",
    name: "Aboveground Biomass",
    category: "infrastructure",
    description: "GEDI ISS L4B aboveground biomass density — carbon stock estimation",
    defaultEnabled: false,
    accent: "#854d0e",
    dataSource: "/api/biomass/{z}/{x}/{y}",
  },
  {
    id: "seaSalinity",
    name: "Sea Surface Salinity",
    category: "ocean",
    description: "SMAP L3 sea surface salinity — ocean circulation, freshwater input tracking",
    defaultEnabled: false,
    accent: "#0284c7",
    dataSource: "/api/sea-salinity/{z}/{x}/{y}",
  },
  {
    id: "seaHeight",
    name: "Sea Surface Height",
    category: "ocean",
    description: "JPL MEaSUREs sea surface height anomalies — ENSO, ocean circulation monitoring",
    defaultEnabled: false,
    accent: "#7c3aed",
    dataSource: "/api/sea-height/{z}/{x}/{y}",
  },
  {
    id: "oceanCurrents",
    name: "Ocean Currents",
    category: "ocean",
    description: "18 major ocean circulation patterns with animated flow particles (warm/cold/circumpolar)",
    defaultEnabled: false,
    accent: "#00ccff",
  },

  /* ── Risk & Air Quality ─────────────────────────────── */
  {
    id: "floodHazard",
    name: "Flood Hazard",
    category: "hazards",
    description: "NASA NDH global flood hazard frequency distribution (1985-2003 baseline)",
    defaultEnabled: false,
    accent: "#2563eb",
    dataSource: "/api/flood-hazard/{z}/{x}/{y}",
  },
  {
    id: "landslideHazard",
    name: "Landslide Hazard",
    category: "hazards",
    description: "NASA NDH global landslide hazard distribution (2000 baseline)",
    defaultEnabled: false,
    accent: "#92400e",
    dataSource: "/api/landslide-hazard/{z}/{x}/{y}",
  },
  {
    id: "droughtHazard",
    name: "Drought Hazard",
    category: "hazards",
    description: "NASA NDH global drought hazard frequency distribution (1980-2000 baseline)",
    defaultEnabled: false,
    accent: "#ca8a04",
    dataSource: "/api/drought-hazard/{z}/{x}/{y}",
  },
  {
    id: "pm25",
    name: "PM2.5 Concentration",
    category: "atmosphere",
    description: "Global particulate matter below 2.5μm — air quality health risk indicator",
    defaultEnabled: false,
    accent: "#b91c1c",
    dataSource: "/api/pm25/{z}/{x}/{y}",
  },
  {
    id: "aod",
    name: "Aerosol Optical Depth",
    category: "atmosphere",
    description: "MODIS Aqua AOD — atmospheric aerosol load from dust, smoke, pollution",
    defaultEnabled: false,
    accent: "#a16207",
    dataSource: "/api/aod/{z}/{x}/{y}",
  },
  {
    id: "seaIce",
    name: "Sea Ice",
    category: "ocean",
    description: "Sea ice concentration from NSIDC and OSI SAF satellite observations",
    defaultEnabled: false,
    accent: "#93c5fd",
    dataSource: "https://nsidc.org/",
  },
  {
    id: "burnScars",
    name: "Active Fires",
    category: "hazards",
    description: "NASA VIIRS active fire detections — global wildfire monitoring",
    defaultEnabled: false,
    accent: "#f97316",
    dataSource: "https://firms.modaps.eosdis.nasa.gov/",
  },

  /* ── Lightning ────────────────────────────────────────── */
  {
    id: "lightning",
    name: "Lightning",
    category: "atmosphere",
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
  "hillshade",
  "terrain",
  "atmosphere",
  "hazards",
  "ocean",
  "aviation",
  "infrastructure",
  "imagery",
  "space",
  "hydro",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  hillshade: "🏔️ Hillshade",
  terrain: "🏔️ Terrain",
  atmosphere: "🌤️ Atmosphere",
  hazards: "⚠️ Hazards & Disasters",
  ocean: "🌊 Ocean",
  aviation: "✈️ Aviation",
  infrastructure: "🏗️ Infrastructure",
  imagery: "🛰️ Imagery",
  space: "🚀 Space",
  hydro: "💧 Hydrography",
};
