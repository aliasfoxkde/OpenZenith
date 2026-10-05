import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

const seasalinitySpec: RasterLayerSpec = {
  sourceId: "sea-salinity",
  tiles: ["/api/sea-salinity/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 5,
  statusId: "seaSalinity",
};

/**
 * Add the sea-salinity raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "seaSalinity" id.
 */
export function addSeaSalinity(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, seasalinitySpec);
}
/** Remove the sea-salinity raster layer and its source, ignoring errors. */
export function removeSeaSalinity(map: maplibregl.Map): void {
  removeRasterLayer(map, "sea-salinity");
}
