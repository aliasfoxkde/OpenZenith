import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Fire Temperature (GOES-East ABI Fire Temperature) ─── */

const firetemperatureSpec: RasterLayerSpec = {
  sourceId: "fire-temperature",
  tiles: ["/api/fire-temperature/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 1,
  maxzoom: 9,
  statusId: "fireTemperature",
};

/**
 * Add the fire-temperature raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "fireTemperature" id.
 */
export function addFireTemperature(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, firetemperatureSpec);
}
/** Remove the fire-temperature raster layer and its source, ignoring errors. */
export function removeFireTemperature(map: maplibregl.Map): void {
  removeRasterLayer(map, "fire-temperature");
}
