import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Elevation Color Heatmap ─── */

const elevationcolorSpec: RasterLayerSpec = {
  sourceId: "elevation-color",
  tiles: ["/api/elevation-color/{z}/{x}/{y}"],
  opacity: 0.75,
  minzoom: 7,
  maxzoom: 12,
  layerId: "elevation-color-layer",
  reportStatus: false,
};

/**
 * Add the elevation-color raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). No status is written to the handle; failures are logged, not thrown.
 */
export function addElevationColor(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, elevationcolorSpec);
}
/** Remove the elevation-color raster layer and its source, ignoring errors. */
export function removeElevationColor(map: maplibregl.Map): void {
  removeRasterLayer(map, "elevation-color", "elevation-color-layer");
}
