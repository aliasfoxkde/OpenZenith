import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addPM25(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("pm25")) return;
  try {
    map.addSource("pm25", { type: "raster", tiles: ["/api/pm25/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 5 });
    map.addLayer({ id: "pm25-raster", type: "raster", source: "pm25", paint: { "raster-opacity": 0.8 } });
    setStatus(handle, "pm25", "loaded");
  } catch {
    setStatus(handle, "pm25", "error");
  }
}
export function removePM25(map: maplibregl.Map): void {
  try {
    map.removeLayer("pm25-raster");
  } catch {}
  try {
    map.removeSource("pm25");
  } catch {}
}
