import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const snowcoverSpec: RasterLayerSpec = {
  sourceId: "snow-cover",
  tiles: ["/api/snow-cover/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 0,
  maxzoom: 8,
  statusId: "snowCover",
};

/**
 * Add the snow-cover raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "snowCover" id.
 */
export function addSnowCover(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, snowcoverSpec);
}
/** Remove the snow-cover raster layer and its source, ignoring errors. */
export function removeSnowCover(map: maplibregl.Map): void {
  removeRasterLayer(map, "snow-cover");
}
