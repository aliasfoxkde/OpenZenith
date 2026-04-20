/**
 * MapLibre data layer loaders for 2D map page.
 *
 * Each layer module provides add/remove functions compatible with MapLibre GL's
 * source/layer API. Layers that fetch GeoJSON data from APIs include
 * auto-refresh via setInterval (returned for cleanup).
 *
 * Layer status tracking: callers can pass a statusCallback to get notified
 * when layers load, error, or return empty data.
 */

export { type LayerStatus, type LayerHandle, createLayerHandle, setStatus, latLonToTile } from "./types";

// Terrain
export { addHillshade, removeHillshade } from "./hillshade";
export { addElevationColor, removeElevationColor } from "./elevation-color";
export { addElevationAccuracy, removeElevationAccuracy } from "./elevation-accuracy";
export { addContours, removeContours } from "./contours";

// Weather
export { addEarthquakes, removeEarthquakes, setEarthquakeFeed, setEarthquakeTimeFilter, getEarthquakeTimeRange, refreshEarthquakeFilter } from "./earthquakes";
export { addWarnings, removeWarnings } from "./warnings";
export { addNaturalEvents, removeNaturalEvents } from "./events";
export { addRadar, removeRadar } from "./radar";
export { addHurricaneTracks, removeHurricaneTracks, startHurricaneAnimation, stopHurricaneAnimation } from "./hurricanes";
export { addWildfires, removeWildfires } from "./wildfires";

// Infrastructure
export { addNLNOGNodes, removeNLNOGNodes } from "./nlnog";
export { addBuildings, removeBuildings } from "./buildings";
export { addPopulationDensity, removePopulationDensity } from "./population";
export { addLandCover, removeLandCover } from "./landcover";
export { addWaterways, removeWaterways } from "./waterways";

// Imagery
export { addSentinel2, removeSentinel2 } from "./sentinel2";

// Aviation
export { addFlights, removeFlights } from "./flights";
export { addMilitary, removeMilitary } from "./military";

// Maritime
export { addVessels, removeVessels } from "./vessels";
export { addMarineWeather, removeMarineWeather } from "./marine-weather";

// Space / Space Weather
export { addSpaceWeather, removeSpaceWeather } from "./space-weather";
export { addLightning, removeLightning } from "./lightning";

// Imagery
export { addNightLights, removeNightLights } from "./night-lights";

// Disaster
export { addVolcanoes, removeVolcanoes } from "./volcanoes";
export { addGdacs, removeGdacs } from "./gdacs";

// SAR / Environmental
export { addFloods, removeFloods } from "./floods";
export { addFireTemperature, removeFireTemperature } from "./fire-temperature";
export { addSarBackscatter, removeSarBackscatter } from "./sar-backscatter";
export { addSeaIce, removeSeaIce } from "./sea-ice";
export { addBurnScars, removeBurnScars } from "./burn-scars";

// Environment
export { addAirQuality, removeAirQuality } from "./airquality";

// Aviation Weather
export { addAviationWeather, removeAviationWeather } from "./aviation-weather";

// Satellites
export { addSatellites, removeSatellites } from "./satellites";

// Bathymetry
export { addBathymetry, removeBathymetry } from "./bathymetry";

// GOES Satellite Imagery
export { addSatelliteImagery, removeSatelliteImagery } from "./satellite-imagery";

// ─── Master dispatcher ───

import type { LayerHandle } from "./types";
import { addHillshade, removeHillshade } from "./hillshade";
import { addElevationColor, removeElevationColor } from "./elevation-color";
import { addElevationAccuracy, removeElevationAccuracy } from "./elevation-accuracy";
import { addContours, removeContours } from "./contours";
import { addEarthquakes, removeEarthquakes } from "./earthquakes";
import { addWarnings, removeWarnings } from "./warnings";
import { addNaturalEvents, removeNaturalEvents } from "./events";
import { addRadar, removeRadar } from "./radar";
import { addWaterways, removeWaterways } from "./waterways";
import { addHurricaneTracks, removeHurricaneTracks } from "./hurricanes";
import { addNLNOGNodes, removeNLNOGNodes } from "./nlnog";
import { addWildfires, removeWildfires } from "./wildfires";
import { addBuildings, removeBuildings } from "./buildings";
import { addPopulationDensity, removePopulationDensity } from "./population";
import { addLandCover, removeLandCover } from "./landcover";
import { addSentinel2, removeSentinel2 } from "./sentinel2";
import { addAirQuality, removeAirQuality } from "./airquality";
import { addFlights, removeFlights } from "./flights";
import { addMilitary, removeMilitary } from "./military";
import { addVessels, removeVessels } from "./vessels";
import { addMarineWeather, removeMarineWeather } from "./marine-weather";
import { addSpaceWeather, removeSpaceWeather } from "./space-weather";
import { addLightning, removeLightning } from "./lightning";
import { addNightLights, removeNightLights } from "./night-lights";
import { addVolcanoes, removeVolcanoes } from "./volcanoes";
import { addGdacs, removeGdacs } from "./gdacs";
import { addFloods, removeFloods } from "./floods";
import { addFireTemperature, removeFireTemperature } from "./fire-temperature";
import { addSarBackscatter, removeSarBackscatter } from "./sar-backscatter";
import { addSeaIce, removeSeaIce } from "./sea-ice";
import { addBurnScars, removeBurnScars } from "./burn-scars";
import { addAviationWeather, removeAviationWeather } from "./aviation-weather";
import { addSatellites, removeSatellites } from "./satellites";
import { addBathymetry, removeBathymetry } from "./bathymetry";
import { addSatelliteImagery, removeSatelliteImagery } from "./satellite-imagery";

const LAYER_HANDLERS: Record<
  string,
  {
    add: (map: maplibregl.Map, handle: LayerHandle) => void;
    remove: (map: maplibregl.Map) => void;
  }
> = {
  hillshade: { add: addHillshade, remove: removeHillshade },
  elevationColor: { add: addElevationColor, remove: removeElevationColor },
  elevationAccuracy: { add: addElevationAccuracy, remove: removeElevationAccuracy },
  contours: { add: addContours, remove: removeContours },
  earthquakes: { add: addEarthquakes, remove: removeEarthquakes },
  warnings: { add: addWarnings, remove: removeWarnings },
  events: { add: addNaturalEvents, remove: removeNaturalEvents },
  radar: { add: addRadar, remove: removeRadar },
  waterways: { add: addWaterways, remove: removeWaterways },
  hurricaneTracks: { add: addHurricaneTracks, remove: removeHurricaneTracks },
  nlnogNodes: { add: addNLNOGNodes, remove: removeNLNOGNodes },
  wildfires: { add: addWildfires, remove: removeWildfires },
  buildings: { add: addBuildings, remove: removeBuildings },
  populationDensity: { add: addPopulationDensity, remove: removePopulationDensity },
  landCover: { add: addLandCover, remove: removeLandCover },
  sentinel2: { add: addSentinel2, remove: removeSentinel2 },
  airQuality: { add: addAirQuality, remove: removeAirQuality },
  flights: { add: addFlights, remove: removeFlights },
  militaryFlights: { add: addMilitary, remove: removeMilitary },
  vessels: { add: addVessels, remove: removeVessels },
  marineWeather: { add: addMarineWeather, remove: removeMarineWeather },
  spaceWeather: { add: addSpaceWeather, remove: removeSpaceWeather },
  lightning: { add: addLightning, remove: removeLightning },
  nightLights: { add: addNightLights, remove: removeNightLights },
  volcanoes: { add: addVolcanoes, remove: removeVolcanoes },
  gdacs: { add: addGdacs, remove: removeGdacs },
  floods: { add: addFloods, remove: removeFloods },
  fireTemperature: { add: addFireTemperature, remove: removeFireTemperature },
  sarBackscatter: { add: addSarBackscatter, remove: removeSarBackscatter },
  seaIce: { add: addSeaIce, remove: removeSeaIce },
  burnScars: { add: addBurnScars, remove: removeBurnScars },
  aviationWeather: { add: addAviationWeather, remove: removeAviationWeather },
  satellites: { add: addSatellites, remove: removeSatellites },
  bathymetry: { add: addBathymetry, remove: removeBathymetry },
  satellite: { add: addSatelliteImagery, remove: removeSatelliteImagery },
};

export function addDataLayer(map: maplibregl.Map, handle: LayerHandle, layerId: string): void {
  const handler = LAYER_HANDLERS[layerId];
  if (handler) handler.add(map, handle);
}

export function removeDataLayer(map: maplibregl.Map, layerId: string): void {
  const handler = LAYER_HANDLERS[layerId];
  if (handler) handler.remove(map);
}

/** Layer IDs that are available in MapLibre 2D context. */
export const MAP_2D_LAYER_IDS = new Set(Object.keys(LAYER_HANDLERS));
