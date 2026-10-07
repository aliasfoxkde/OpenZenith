import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Sentinel-2 Imagery ─── */

const sentinel2Spec: RasterLayerSpec = {
  sourceId: "sentinel2",
  tiles: ["/api/sentinel2/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 3,
  maxzoom: 14,
  layerId: "sentinel2-layer",
  paint: { "raster-saturation": 0.3 },
};

/**
 * Add the sentinel2 raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above), reporting "loaded"/"error" on the
 * handle under the layer id.
 */
export function addSentinel2(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, sentinel2Spec);
}
/** Remove the sentinel2 raster layer and its source, ignoring errors. */
export function removeSentinel2(map: maplibregl.Map): void {
  removeRasterLayer(map, "sentinel2", "sentinel2-layer");
}
