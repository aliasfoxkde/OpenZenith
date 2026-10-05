import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── SO₂ Volcanic (TROPOMI L2) ─── */

const so2volcanicSpec: RasterLayerSpec = {
  sourceId: "so2-volcanic",
  tiles: ["/api/so2-volcanic/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 0,
  maxzoom: 5,
  statusId: "so2Volcanic",
};

/**
 * Add the so2-volcanic raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "so2Volcanic" id.
 */
export function addSo2Volcanic(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, so2volcanicSpec);
}
/** Remove the so2-volcanic raster layer and its source, ignoring errors. */
export function removeSo2Volcanic(map: maplibregl.Map): void {
  removeRasterLayer(map, "so2-volcanic");
}
