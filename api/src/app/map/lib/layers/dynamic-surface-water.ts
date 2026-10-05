import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Dynamic Surface Water Extent (OPERA L3, Sentinel-1) ─── */

const dynamicsurfacewaterSpec: RasterLayerSpec = {
  sourceId: "dynamic-surface-water",
  tiles: ["/api/dynamic-surface-water/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 9,
  statusId: "dynamicSurfaceWater",
};

/**
 * Add the dynamic-surface-water raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "dynamicSurfaceWater" id.
 */
export function addDynamicSurfaceWater(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, dynamicsurfacewaterSpec);
}
/** Remove the dynamic-surface-water raster layer and its source, ignoring errors. */
export function removeDynamicSurfaceWater(map: maplibregl.Map): void {
  removeRasterLayer(map, "dynamic-surface-water");
}
