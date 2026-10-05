import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Flood Extent (NASA GIBS VIIRS Combined 3-Day Flood) ─── */

const floodsSpec: RasterLayerSpec = {
  sourceId: "floods",
  tiles: ["/api/floods-tile/{z}/{x}/{y}"],
  opacity: 0.75,
  minzoom: 0,
  maxzoom: 9,
};

/**
 * Add the floods raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "floods" id.
 */
export function addFloods(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, floodsSpec);
}
/** Remove the floods raster layer and its source, ignoring errors. */
export function removeFloods(map: maplibregl.Map): void {
  removeRasterLayer(map, "floods");
}
