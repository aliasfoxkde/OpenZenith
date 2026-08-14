import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── SO₂ Volcanic (TROPOMI L2) ─── */

export function addSo2Volcanic(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("so2-volcanic")) return;

  try {
    if (!map.getSource("so2-volcanic")) {
      map.addSource("so2-volcanic", {
        type: "raster",
        tiles: ["/api/so2-volcanic/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 5,
      });
    }
    if (!map.getLayer("so2-volcanic-raster")) {
      map.addLayer({
        id: "so2-volcanic-raster",
        type: "raster",
        source: "so2-volcanic",
        paint: { "raster-opacity": 0.8 },
      });
    }
    setStatus(handle, "so2Volcanic", "loaded");
  } catch {
    setStatus(handle, "so2Volcanic", "error");
  }
}

export function removeSo2Volcanic(map: maplibregl.Map): void {
  try {
    map.removeLayer("so2-volcanic-raster");
  } catch {}
  try {
    map.removeSource("so2-volcanic");
  } catch {}
}
