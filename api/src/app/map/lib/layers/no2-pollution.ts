import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── NO₂ Air Pollution (TROPOMI L2) ─── */

const no2pollutionSpec: RasterLayerSpec = {
  sourceId: "no2-pollution",
  tiles: ["/api/no2-pollution/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 0,
  maxzoom: 5,
  statusId: "no2Pollution",
};

/**
 * Add the no2-pollution raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "no2Pollution" id.
 */
export function addNo2Pollution(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, no2pollutionSpec);
}
/** Remove the no2-pollution raster layer and its source, ignoring errors. */
export function removeNo2Pollution(map: maplibregl.Map): void {
  removeRasterLayer(map, "no2-pollution");
}
