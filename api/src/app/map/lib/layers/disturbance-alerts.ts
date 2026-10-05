import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Disturbance Alerts (OPERA L3 DIST-ALERT HLS) ─── */

const disturbancealertsSpec: RasterLayerSpec = {
  sourceId: "disturbance-alerts",
  tiles: ["/api/disturbance-alerts/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 8,
  statusId: "disturbanceAlerts",
};

/**
 * Add the disturbance-alerts raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "disturbanceAlerts" id.
 */
export function addDisturbanceAlerts(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, disturbancealertsSpec);
}
/** Remove the disturbance-alerts raster layer and its source, ignoring errors. */
export function removeDisturbanceAlerts(map: maplibregl.Map): void {
  removeRasterLayer(map, "disturbance-alerts");
}
