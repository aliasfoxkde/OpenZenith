import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── NDVI (MODIS Terra L3 16-Day) ─── */

const ndviSpec: RasterLayerSpec = {
  sourceId: "ndvi",
  tiles: ["/api/ndvi/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 9,
};

/**
 * Add the ndvi raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "ndvi" id.
 */
export function addNdvi(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, ndviSpec);
}
/** Remove the ndvi raster layer and its source, ignoring errors. */
export function removeNdvi(map: maplibregl.Map): void {
  removeRasterLayer(map, "ndvi");
}
