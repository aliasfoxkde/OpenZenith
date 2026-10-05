import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Soil Moisture (SMAP L3) ─── */

const soilmoistureSpec: RasterLayerSpec = {
  sourceId: "soil-moisture",
  tiles: ["/api/soil-moisture/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 3,
  statusId: "soilMoisture",
};

/**
 * Add the soil-moisture raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "soilMoisture" id.
 */
export function addSoilMoisture(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, soilmoistureSpec);
}
/** Remove the soil-moisture raster layer and its source, ignoring errors. */
export function removeSoilMoisture(map: maplibregl.Map): void {
  removeRasterLayer(map, "soil-moisture");
}
