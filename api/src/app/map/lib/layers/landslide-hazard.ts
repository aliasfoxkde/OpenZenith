import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const landslidehazardSpec: RasterLayerSpec = {
  sourceId: "landslide-hazard",
  tiles: ["/api/landslide-hazard/{z}/{x}/{y}"],
  opacity: 0.8,
  minzoom: 0,
  maxzoom: 8,
  statusId: "landslideHazard",
};

/**
 * Add the landslide-hazard raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "landslideHazard" id.
 */
export function addLandslideHazard(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, landslidehazardSpec);
}
/** Remove the landslide-hazard raster layer and its source, ignoring errors. */
export function removeLandslideHazard(map: maplibregl.Map): void {
  removeRasterLayer(map, "landslide-hazard");
}
