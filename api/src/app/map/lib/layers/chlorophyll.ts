import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const chlorophyllSpec: RasterLayerSpec = {
  sourceId: "chlorophyll",
  tiles: ["/api/chlorophyll/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 7,
};

/**
 * Add the chlorophyll raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "chlorophyll" id.
 */
export function addChlorophyll(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, chlorophyllSpec);
}
/** Remove the chlorophyll raster layer and its source, ignoring errors. */
export function removeChlorophyll(map: maplibregl.Map): void {
  removeRasterLayer(map, "chlorophyll");
}
