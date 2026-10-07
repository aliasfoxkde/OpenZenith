import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── CORINE Land Cover ─── */

const landcoverSpec: RasterLayerSpec = {
  sourceId: "land-cover",
  tiles: ["/api/landcover/{z}/{x}/{y}"],
  opacity: 0.5,
  minzoom: 4,
  maxzoom: 13,
  layerId: "land-cover-layer",
};

/**
 * Add the land-cover raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above), reporting "loaded"/"error" on the
 * handle under the layer id.
 */
export function addLandCover(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, landcoverSpec);
}
/** Remove the land-cover raster layer and its source, ignoring errors. */
export function removeLandCover(map: maplibregl.Map): void {
  removeRasterLayer(map, "land-cover", "land-cover-layer");
}
