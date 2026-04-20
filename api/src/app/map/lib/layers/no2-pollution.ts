import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── NO₂ Air Pollution (TROPOMI L2) ─── */

export function addNo2Pollution(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("no2-pollution")) return;

  try {
    if (!map.getSource("no2-pollution")) {
      map.addSource("no2-pollution", {
        type: "raster",
        tiles: ["/api/no2-pollution/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 5,
      });
    }
    if (!map.getLayer("no2-pollution-raster")) {
      map.addLayer({
        id: "no2-pollution-raster",
        type: "raster",
        source: "no2-pollution",
        paint: { "raster-opacity": 0.8 },
      });
    }
    setStatus(handle, "no2Pollution", "loaded");
  } catch {
    setStatus(handle, "no2Pollution", "error");
  }
}

export function removeNo2Pollution(map: maplibregl.Map): void {
  try { map.removeLayer("no2-pollution-raster"); } catch {}
  try { map.removeSource("no2-pollution"); } catch {}
}
