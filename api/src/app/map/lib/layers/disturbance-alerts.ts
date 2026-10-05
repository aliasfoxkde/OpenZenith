import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── Disturbance Alerts (OPERA L3 DIST-ALERT HLS) ─── */

/**
 * Add the OPERA L3 DIST-ALERT vegetation-disturbance raster: a 256px source
 * at /api/disturbance-alerts/{z}/{x}/{y} (HLS-derived alerts, zooms 0-8) at
 * 0.85 opacity. Unlike most raster loaders this one guards each addSource /
 * addLayer individually, so a partially-registered layer still gets its
 * missing half. Reports "loaded"/"error" under the camelCase id
 * "disturbanceAlerts".
 */
export function addDisturbanceAlerts(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("disturbance-alerts")) return;

  try {
    if (!map.getSource("disturbance-alerts")) {
      map.addSource("disturbance-alerts", {
        type: "raster",
        tiles: ["/api/disturbance-alerts/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 8,
      });
    }
    if (!map.getLayer("disturbance-alerts-raster")) {
      map.addLayer({
        id: "disturbance-alerts-raster",
        type: "raster",
        source: "disturbance-alerts",
        paint: { "raster-opacity": 0.85 },
      });
    }
    setStatus(handle, "disturbanceAlerts", "loaded");
  } catch (err) {
    warnLayerError("disturbanceAlerts", err);
    setStatus(handle, "disturbanceAlerts", "error");
  }
}

/** Remove the disturbance-alerts raster layer and its source, ignoring "not found" errors. */
export function removeDisturbanceAlerts(map: maplibregl.Map): void {
  try {
    map.removeLayer("disturbance-alerts-raster");
  } catch {}
  try {
    map.removeSource("disturbance-alerts");
  } catch {}
}
