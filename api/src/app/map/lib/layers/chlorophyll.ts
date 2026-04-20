import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addChlorophyll(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("chlorophyll")) return;
  try {
    map.addSource("chlorophyll", { type: "raster", tiles: ["/api/chlorophyll/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 7 });
    map.addLayer({ id: "chlorophyll-raster", type: "raster", source: "chlorophyll", paint: { "raster-opacity": 0.85 } });
    setStatus(handle, "chlorophyll", "loaded");
  } catch { setStatus(handle, "chlorophyll", "error"); }
}
export function removeChlorophyll(map: maplibregl.Map): void {
  try { map.removeLayer("chlorophyll-raster"); } catch {}
  try { map.removeSource("chlorophyll"); } catch {}
}
