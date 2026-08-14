import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Soil Moisture (SMAP L3) ─── */

export function addSoilMoisture(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("soil-moisture")) return;

  try {
    if (!map.getSource("soil-moisture")) {
      map.addSource("soil-moisture", {
        type: "raster",
        tiles: ["/api/soil-moisture/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 3,
      });
    }
    if (!map.getLayer("soil-moisture-raster")) {
      map.addLayer({
        id: "soil-moisture-raster",
        type: "raster",
        source: "soil-moisture",
        paint: { "raster-opacity": 0.85 },
      });
    }
    setStatus(handle, "soilMoisture", "loaded");
  } catch {
    setStatus(handle, "soilMoisture", "error");
  }
}

export function removeSoilMoisture(map: maplibregl.Map): void {
  try {
    map.removeLayer("soil-moisture-raster");
  } catch {}
  try {
    map.removeSource("soil-moisture");
  } catch {}
}
