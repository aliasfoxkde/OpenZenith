import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Disturbance Alerts (OPERA L3 DIST-ALERT HLS) ─── */

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
  } catch {
    setStatus(handle, "disturbanceAlerts", "error");
  }
}

export function removeDisturbanceAlerts(map: maplibregl.Map): void {
  try { map.removeLayer("disturbance-alerts-raster"); } catch {}
  try { map.removeSource("disturbance-alerts"); } catch {}
}
