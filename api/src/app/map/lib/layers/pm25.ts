import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const pm25Spec: RasterLayerSpec = {
  sourceId: "pm25",
  tiles: ["/api/pm25/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 0,
  maxzoom: 5,
};

/**
 * Add the pm25 raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "pm25" id.
 */
export function addPM25(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, pm25Spec);
}
/** Remove the pm25 raster layer and its source, ignoring errors. */
export function removePM25(map: maplibregl.Map): void {
  removeRasterLayer(map, "pm25");
}
