import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const aodSpec: RasterLayerSpec = {
  sourceId: "aod",
  tiles: ["/api/aod/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 0,
  maxzoom: 5,
};

/**
 * Add the aod raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "aod" id.
 */
export function addAOD(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, aodSpec);
}
/** Remove the aod raster layer and its source, ignoring errors. */
export function removeAOD(map: maplibregl.Map): void {
  removeRasterLayer(map, "aod");
}
