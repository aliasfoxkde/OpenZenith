import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addSnowCover(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("snow-cover")) return;
  try {
    map.addSource("snow-cover", { type: "raster", tiles: ["/api/snow-cover/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 8 });
    map.addLayer({ id: "snow-cover-raster", type: "raster", source: "snow-cover", paint: { "raster-opacity": 0.8 } });
    setStatus(handle, "snowCover", "loaded");
  } catch { setStatus(handle, "snowCover", "error"); }
}
export function removeSnowCover(map: maplibregl.Map): void {
  try { map.removeLayer("snow-cover-raster"); } catch {}
  try { map.removeSource("snow-cover"); } catch {}
}
