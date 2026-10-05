import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const droughthazardSpec: RasterLayerSpec = {
  sourceId: "drought-hazard",
  tiles: ["/api/drought-hazard/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 0,
  maxzoom: 8,
  statusId: "droughtHazard",
};

/**
 * Add the drought-hazard raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "droughtHazard" id.
 */
export function addDroughtHazard(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, droughthazardSpec);
}
/** Remove the drought-hazard raster layer and its source, ignoring errors. */
export function removeDroughtHazard(map: maplibregl.Map): void {
  removeRasterLayer(map, "drought-hazard");
}
