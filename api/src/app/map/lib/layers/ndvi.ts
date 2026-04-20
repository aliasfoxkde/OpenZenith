import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── NDVI (MODIS Terra L3 16-Day) ─── */

export function addNdvi(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("ndvi")) return;

  try {
    if (!map.getSource("ndvi")) {
      map.addSource("ndvi", {
        type: "raster",
        tiles: ["/api/ndvi/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 9,
      });
    }
    if (!map.getLayer("ndvi-raster")) {
      map.addLayer({
        id: "ndvi-raster",
        type: "raster",
        source: "ndvi",
        paint: { "raster-opacity": 0.85 },
      });
    }
    setStatus(handle, "ndvi", "loaded");
  } catch {
    setStatus(handle, "ndvi", "error");
  }
}

export function removeNdvi(map: maplibregl.Map): void {
  try { map.removeLayer("ndvi-raster"); } catch {}
  try { map.removeSource("ndvi"); } catch {}
}
