import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const floodhazardSpec: RasterLayerSpec = {
  sourceId: "flood-hazard",
  tiles: ["/api/flood-hazard/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 0,
  maxzoom: 8,
  statusId: "floodHazard",
};

/**
 * Add the flood-hazard raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "floodHazard" id.
 */
export function addFloodHazard(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, floodhazardSpec);
}
/** Remove the flood-hazard raster layer and its source, ignoring errors. */
export function removeFloodHazard(map: maplibregl.Map): void {
  removeRasterLayer(map, "flood-hazard");
}
