/**
 * MapLibre data layer loaders for 2D map page.
 *
 * Each layer module provides add/remove functions compatible with MapLibre
 * GL's source/layer API. Layers that fetch GeoJSON data from APIs include
 * auto-refresh via setInterval (returned for cleanup).
 *
 * Layer status tracking: callers can pass a statusCallback to get notified
 * when layers load, error, or return empty data.
 *
 * Layer modules load lazily: the dispatcher holds dynamic imports, so a
 * module's code ships in its own chunk and is fetched on first add instead
 * of riding in /map's initial JS (the eager barrel was ~67KB across ~50
 * modules for a page whose default view needs none of them). earthquakes
 * stays eager — it is a default-on layer with synchronous timeline state.
 */

export { type LayerStatus, type LayerHandle, createLayerHandle, setStatus, latLonToTile } from "./types";

// Default-on layer: eagerly re-exported so the page's timeline wiring keeps
// its synchronous helpers (setEarthquakeFeed / getEarthquakeTimeRange / …).
export {
  addEarthquakes,
  removeEarthquakes,
  setEarthquakeFeed,
  setEarthquakeTimeFilter,
  getEarthquakeTimeRange,
  refreshEarthquakeFilter,
} from "./earthquakes";

import type { LayerHandle } from "./types";

/** The add/remove surface every layer module exposes. */
interface LayerModule {
  add: (map: maplibregl.Map, handle: LayerHandle) => void;
  remove: (map: maplibregl.Map) => void;
}

// Registry key -> dynamic loader. Modules split into their own chunks and are
// fetched on first add; earthquakes resolves from the main chunk (still eager).
// Partial: callers pass arbitrary registry ids, so lookup can miss.
const LAYER_LOADERS: Partial<Record<string, () => Promise<LayerModule>>> = {
  hillshade: () =>
    import("./hillshade").then((m) => ({ add: m.addHillshade, remove: m.removeHillshade })),
  elevationColor: () =>
    import("./elevation-color").then((m) => ({ add: m.addElevationColor, remove: m.removeElevationColor })),
  elevationAccuracy: () =>
    import("./elevation-accuracy").then((m) => ({ add: m.addElevationAccuracy, remove: m.removeElevationAccuracy })),
  contours: () =>
    import("./contours").then((m) => ({ add: m.addContours, remove: m.removeContours })),
  earthquakes: () =>
    import("./earthquakes").then((m) => ({ add: m.addEarthquakes, remove: m.removeEarthquakes })),
  warnings: () =>
    import("./warnings").then((m) => ({ add: m.addWarnings, remove: m.removeWarnings })),
  events: () =>
    import("./events").then((m) => ({ add: m.addNaturalEvents, remove: m.removeNaturalEvents })),
  radar: () =>
    import("./radar").then((m) => ({ add: m.addRadar, remove: m.removeRadar })),
  waterways: () =>
    import("./waterways").then((m) => ({ add: m.addWaterways, remove: m.removeWaterways })),
  hurricaneTracks: () =>
    import("./hurricanes").then((m) => ({ add: m.addHurricaneTracks, remove: m.removeHurricaneTracks })),
  nlnogNodes: () =>
    import("./nlnog").then((m) => ({ add: m.addNLNOGNodes, remove: m.removeNLNOGNodes })),
  wildfires: () =>
    import("./wildfires").then((m) => ({ add: m.addWildfires, remove: m.removeWildfires })),
  buildings: () =>
    import("./buildings").then((m) => ({ add: m.addBuildings, remove: m.removeBuildings })),
  populationDensity: () =>
    import("./population").then((m) => ({ add: m.addPopulationDensity, remove: m.removePopulationDensity })),
  landCover: () =>
    import("./landcover").then((m) => ({ add: m.addLandCover, remove: m.removeLandCover })),
  sentinel2: () =>
    import("./sentinel2").then((m) => ({ add: m.addSentinel2, remove: m.removeSentinel2 })),
  airQuality: () =>
    import("./airquality").then((m) => ({ add: m.addAirQuality, remove: m.removeAirQuality })),
  flights: () =>
    import("./flights").then((m) => ({ add: m.addFlights, remove: m.removeFlights })),
  militaryFlights: () =>
    import("./military").then((m) => ({ add: m.addMilitary, remove: m.removeMilitary })),
  vessels: () =>
    import("./vessels").then((m) => ({ add: m.addVessels, remove: m.removeVessels })),
  marineWeather: () =>
    import("./marine-weather").then((m) => ({ add: m.addMarineWeather, remove: m.removeMarineWeather })),
  spaceWeather: () =>
    import("./space-weather").then((m) => ({ add: m.addSpaceWeather, remove: m.removeSpaceWeather })),
  lightning: () =>
    import("./lightning").then((m) => ({ add: m.addLightning, remove: m.removeLightning })),
  nightLights: () =>
    import("./night-lights").then((m) => ({ add: m.addNightLights, remove: m.removeNightLights })),
  volcanoes: () =>
    import("./volcanoes").then((m) => ({ add: m.addVolcanoes, remove: m.removeVolcanoes })),
  gdacs: () =>
    import("./gdacs").then((m) => ({ add: m.addGdacs, remove: m.removeGdacs })),
  floods: () =>
    import("./floods").then((m) => ({ add: m.addFloods, remove: m.removeFloods })),
  fireTemperature: () =>
    import("./fire-temperature").then((m) => ({ add: m.addFireTemperature, remove: m.removeFireTemperature })),
  sarBackscatter: () =>
    import("./sar-backscatter").then((m) => ({ add: m.addSarBackscatter, remove: m.removeSarBackscatter })),
  seaIce: () =>
    import("./sea-ice").then((m) => ({ add: m.addSeaIce, remove: m.removeSeaIce })),
  burnScars: () =>
    import("./burn-scars").then((m) => ({ add: m.addBurnScars, remove: m.removeBurnScars })),
  aviationWeather: () =>
    import("./aviation-weather").then((m) => ({ add: m.addAviationWeather, remove: m.removeAviationWeather })),
  satellites: () =>
    import("./satellites").then((m) => ({ add: m.addSatellites, remove: m.removeSatellites })),
  bathymetry: () =>
    import("./bathymetry").then((m) => ({ add: m.addBathymetry, remove: m.removeBathymetry })),
  satellite: () =>
    import("./satellite-imagery").then((m) => ({ add: m.addSatelliteImagery, remove: m.removeSatelliteImagery })),
  dynamicSurfaceWater: () =>
    import("./dynamic-surface-water").then((m) => ({ add: m.addDynamicSurfaceWater, remove: m.removeDynamicSurfaceWater })),
  disturbanceAlerts: () =>
    import("./disturbance-alerts").then((m) => ({ add: m.addDisturbanceAlerts, remove: m.removeDisturbanceAlerts })),
  so2Volcanic: () =>
    import("./so2-volcanic").then((m) => ({ add: m.addSo2Volcanic, remove: m.removeSo2Volcanic })),
  no2Pollution: () =>
    import("./no2-pollution").then((m) => ({ add: m.addNo2Pollution, remove: m.removeNo2Pollution })),
  precipitation: () =>
    import("./precipitation").then((m) => ({ add: m.addPrecipitation, remove: m.removePrecipitation })),
  soilMoisture: () =>
    import("./soil-moisture").then((m) => ({ add: m.addSoilMoisture, remove: m.removeSoilMoisture })),
  ndvi: () =>
    import("./ndvi").then((m) => ({ add: m.addNdvi, remove: m.removeNdvi })),
  sst: () =>
    import("./sst").then((m) => ({ add: m.addSST, remove: m.removeSST })),
  chlorophyll: () =>
    import("./chlorophyll").then((m) => ({ add: m.addChlorophyll, remove: m.removeChlorophyll })),
  snowCover: () =>
    import("./snow-cover").then((m) => ({ add: m.addSnowCover, remove: m.removeSnowCover })),
  seaSalinity: () =>
    import("./sea-salinity").then((m) => ({ add: m.addSeaSalinity, remove: m.removeSeaSalinity })),
  seaHeight: () =>
    import("./sea-height").then((m) => ({ add: m.addSeaHeight, remove: m.removeSeaHeight })),
  oceanCurrents: () =>
    import("./currents").then((m) => ({ add: m.addOceanCurrents, remove: m.removeOceanCurrents })),
  floodHazard: () =>
    import("./flood-hazard").then((m) => ({ add: m.addFloodHazard, remove: m.removeFloodHazard })),
  landslideHazard: () =>
    import("./landslide-hazard").then((m) => ({ add: m.addLandslideHazard, remove: m.removeLandslideHazard })),
  droughtHazard: () =>
    import("./drought-hazard").then((m) => ({ add: m.addDroughtHazard, remove: m.removeDroughtHazard })),
  pm25: () =>
    import("./pm25").then((m) => ({ add: m.addPM25, remove: m.removePM25 })),
  aod: () =>
    import("./aod").then((m) => ({ add: m.addAOD, remove: m.removeAOD })),
  equator: () =>
    import("./equator").then((m) => ({ add: m.addEquator, remove: m.removeEquator })),
};

/**
 * Resources registered by the most recent add of each layer. Layer add
 * functions push refresh intervals onto handle.intervals and (some) set
 * handle.cleanup — both shared slots — so without this bookkeeping a
 * toggle-off could not tell which timers were its own: disabled layers kept
 * polling forever and re-enabling stacked a second timer alongside the
 * first. Scoped here instead, per layer.
 */
const layerResources = new Map<string, { intervals: LayerHandle["intervals"]; cleanup?: () => void }>();

/**
 * Add a data layer by registry id, resolving it through the lazy loader
 * table (dynamic import, so each module ships in its own chunk). Before the
 * module's add() runs, any previous registration of the same id is retired —
 * its cleanup invoked and fresh intervals/cleanup slots swapped into the
 * handle — so re-adding a layer never stacks a second poller or listener on
 * top of the first; the ids are folded back into the shared
 * handle.intervals afterwards for page-level pausing. Unknown ids resolve to
 * a silent no-op.
 */
export async function addDataLayer(map: maplibregl.Map, handle: LayerHandle, layerId: string): Promise<void> {
  const load = LAYER_LOADERS[layerId];
  if (!load) return;
  const mod = await load();
  // Re-add over a live previous registration (e.g. tab-hide resume, which
  // cleared timers but not cleanups): retire the old cleanup first so its
  // listeners do not accumulate per hide/show cycle.
  const existing = layerResources.get(layerId);
  if (existing?.cleanup) existing.cleanup();
  // Swap in fresh slots so whatever this add registers is attributable to
  // this layer, then fold the ids back into the shared handle.intervals —
  // page-level tab-hide and unmount pause everything through that array.
  const prevIntervals = handle.intervals;
  const prevCleanup = handle.cleanup;
  handle.intervals = [];
  handle.cleanup = undefined;
  try {
    mod.add(map, handle);
  } finally {
    const owned = { intervals: handle.intervals, cleanup: handle.cleanup };
    handle.intervals = [...prevIntervals, ...owned.intervals];
    handle.cleanup = prevCleanup;
    layerResources.set(layerId, owned);
  }
}

/**
 * Remove a data layer by registry id: clear the intervals that add captured
 * for it, run its cleanup, drop those ids from the shared handle.intervals,
 * then call the module's remove() to tear down its MapLibre source/layers.
 * Unknown ids (or a remove with no prior add) still run the module's remove,
 * which tolerates missing sources.
 */
export async function removeDataLayer(map: maplibregl.Map, handle: LayerHandle, layerId: string): Promise<void> {
  const owned = layerResources.get(layerId);
  layerResources.delete(layerId);
  if (owned) {
    owned.intervals.forEach(clearInterval);
    owned.cleanup?.();
    // Drop the dead ids from the shared array (tab-hide iterates it).
    const dead = new Set(owned.intervals);
    handle.intervals = handle.intervals.filter((id) => !dead.has(id));
  }
  const load = LAYER_LOADERS[layerId];
  if (load) {
    const mod = await load();
    mod.remove(map);
  }
}

/** Layer IDs that are available in MapLibre 2D context. */
export const MAP_2D_LAYER_IDS = new Set(Object.keys(LAYER_LOADERS));

/* ─── Hurricane animation (module kept lazy; async delegation) ─── */

/**
 * Async passthrough to the hurricanes module's startHurricaneAnimation —
 * same 100 ms playback loop and progress callback, but the dynamic import
 * keeps that code out of /map's initial bundle. Awaits resolution before the
 * animation's first tick.
 */
export async function startHurricaneAnimation(
  map: maplibregl.Map,
  handle: LayerHandle,
  callback: (progress: number) => void,
): Promise<void> {
  const m = await import("./hurricanes");
  m.startHurricaneAnimation(map, handle, callback);
}

/** Async passthrough to the hurricanes module's stopHurricaneAnimation: clear the interval and restore full tracks once the module has loaded. */
export async function stopHurricaneAnimation(map: maplibregl.Map, handle: LayerHandle): Promise<void> {
  const m = await import("./hurricanes");
  m.stopHurricaneAnimation(map, handle);
}
