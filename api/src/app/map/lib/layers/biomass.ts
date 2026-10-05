import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const biomassSpec: RasterLayerSpec = {
  sourceId: "biomass",
  tiles: ["/api/biomass/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 8,
};

/**
 * Add the biomass raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "biomass" id.
 */
export function addBiomass(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, biomassSpec);
}
/** Remove the biomass raster layer and its source, ignoring errors. */
export function removeBiomass(map: maplibregl.Map): void {
  removeRasterLayer(map, "biomass");
}
