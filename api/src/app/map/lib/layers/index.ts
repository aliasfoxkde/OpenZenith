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
export { addDynamicSurfaceWater, removeDynamicSurfaceWater } from "./dynamic-surface-water";
export { addDisturbanceAlerts, removeDisturbanceAlerts } from "./disturbance-alerts";
export { addSo2Volcanic, removeSo2Volcanic } from "./so2-volcanic";
export { addNo2Pollution, removeNo2Pollution } from "./no2-pollution";
export { addPrecipitation, removePrecipitation } from "./precipitation";
export { addSoilMoisture, removeSoilMoisture } from "./soil-moisture";
export { addNdvi, removeNdvi } from "./ndvi";

// Ocean & Climate
export { addSST, removeSST } from "./sst";
export { addChlorophyll, removeChlorophyll } from "./chlorophyll";
export { addSnowCover, removeSnowCover } from "./snow-cover";
export { addSeaSalinity, removeSeaSalinity } from "./sea-salinity";
export { addSeaHeight, removeSeaHeight } from "./sea-height";

// Risk & Air Quality
export { addFloodHazard, removeFloodHazard } from "./flood-hazard";
export { addLandslideHazard, removeLandslideHazard } from "./landslide-hazard";
export { addDroughtHazard, removeDroughtHazard } from "./drought-hazard";
export { addPM25, removePM25 } from "./pm25";
export { addAOD, removeAOD } from "./aod";

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
import { addDynamicSurfaceWater, removeDynamicSurfaceWater } from "./dynamic-surface-water";
import { addDisturbanceAlerts, removeDisturbanceAlerts } from "./disturbance-alerts";
import { addSo2Volcanic, removeSo2Volcanic } from "./so2-volcanic";
import { addNo2Pollution, removeNo2Pollution } from "./no2-pollution";
import { addPrecipitation, removePrecipitation } from "./precipitation";
import { addSoilMoisture, removeSoilMoisture } from "./soil-moisture";
import { addNdvi, removeNdvi } from "./ndvi";
import { addSST, removeSST } from "./sst";
import { addChlorophyll, removeChlorophyll } from "./chlorophyll";
import { addSnowCover, removeSnowCover } from "./snow-cover";
import { addSeaSalinity, removeSeaSalinity } from "./sea-salinity";
import { addSeaHeight, removeSeaHeight } from "./sea-height";
import { addFloodHazard, removeFloodHazard } from "./flood-hazard";
import { addLandslideHazard, removeLandslideHazard } from "./landslide-hazard";
import { addDroughtHazard, removeDroughtHazard } from "./drought-hazard";
import { addPM25, removePM25 } from "./pm25";
import { addAOD, removeAOD } from "./aod";

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
  dynamicSurfaceWater: { add: addDynamicSurfaceWater, remove: removeDynamicSurfaceWater },
  disturbanceAlerts: { add: addDisturbanceAlerts, remove: removeDisturbanceAlerts },
  so2Volcanic: { add: addSo2Volcanic, remove: removeSo2Volcanic },
  no2Pollution: { add: addNo2Pollution, remove: removeNo2Pollution },
  precipitation: { add: addPrecipitation, remove: removePrecipitation },
  soilMoisture: { add: addSoilMoisture, remove: removeSoilMoisture },
  ndvi: { add: addNdvi, remove: removeNdvi },
  sst: { add: addSST, remove: removeSST },
  chlorophyll: { add: addChlorophyll, remove: removeChlorophyll },
  snowCover: { add: addSnowCover, remove: removeSnowCover },
  seaSalinity: { add: addSeaSalinity, remove: removeSeaSalinity },
  seaHeight: { add: addSeaHeight, remove: removeSeaHeight },
  floodHazard: { add: addFloodHazard, remove: removeFloodHazard },
  landslideHazard: { add: addLandslideHazard, remove: removeLandslideHazard },
  droughtHazard: { add: addDroughtHazard, remove: removeDroughtHazard },
  pm25: { add: addPM25, remove: removePM25 },
  aod: { add: addAOD, remove: removeAOD },
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
