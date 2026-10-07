import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Population Density (GHSL) ─── */

const populationdensitySpec: RasterLayerSpec = {
  sourceId: "population-density",
  tiles: ["/api/population/{z}/{x}/{y}"],
  opacity: 0.6,
  minzoom: 2,
  maxzoom: 14,
  layerId: "population-density-layer",
  paint: { "raster-color-mix": ["multiply", ["rgba(0,0,0,0.7)"], ["rgba(255,200,0,1)"]] },
};

/**
 * Add the population-density raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above), reporting "loaded"/"error" on the
 * handle under the layer id.
 */
export function addPopulationDensity(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, populationdensitySpec);
}
/** Remove the population-density raster layer and its source, ignoring errors. */
export function removePopulationDensity(map: maplibregl.Map): void {
  removeRasterLayer(map, "population-density", "population-density-layer");
}
