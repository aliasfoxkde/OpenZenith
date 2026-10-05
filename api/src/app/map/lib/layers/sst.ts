import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const sstSpec: RasterLayerSpec = {
  sourceId: "sst",
  tiles: ["/api/sst/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 8,
};

/**
 * Add the sst raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "sst" id.
 */
export function addSST(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, sstSpec);
}
/** Remove the sst raster layer and its source, ignoring errors. */
export function removeSST(map: maplibregl.Map): void {
  removeRasterLayer(map, "sst");
}
