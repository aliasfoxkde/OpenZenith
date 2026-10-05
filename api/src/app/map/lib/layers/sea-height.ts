import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const seaheightSpec: RasterLayerSpec = {
  sourceId: "sea-height",
  tiles: ["/api/sea-height/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 6,
  statusId: "seaHeight",
};

/**
 * Add the sea-height raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "seaHeight" id.
 */
export function addSeaHeight(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, seaheightSpec);
}
/** Remove the sea-height raster layer and its source, ignoring errors. */
export function removeSeaHeight(map: maplibregl.Map): void {
  removeRasterLayer(map, "sea-height");
}
