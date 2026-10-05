import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Precipitation (IMERG) ─── */

const precipitationSpec: RasterLayerSpec = {
  sourceId: "precipitation",
  tiles: ["/api/precipitation/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 0,
  maxzoom: 8,
};

/**
 * Add the precipitation raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "precipitation" id.
 */
export function addPrecipitation(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, precipitationSpec);
}
/** Remove the precipitation raster layer and its source, ignoring errors. */
export function removePrecipitation(map: maplibregl.Map): void {
  removeRasterLayer(map, "precipitation");
}
