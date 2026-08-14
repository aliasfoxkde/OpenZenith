import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addSeaHeight(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("sea-height")) return;
  try {
    map.addSource("sea-height", {
      type: "raster",
      tiles: ["/api/sea-height/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 6,
    });
    map.addLayer({ id: "sea-height-raster", type: "raster", source: "sea-height", paint: { "raster-opacity": 0.85 } });
    setStatus(handle, "seaHeight", "loaded");
  } catch {
    setStatus(handle, "seaHeight", "error");
  }
}
export function removeSeaHeight(map: maplibregl.Map): void {
  try {
    map.removeLayer("sea-height-raster");
  } catch {}
  try {
    map.removeSource("sea-height");
  } catch {}
}
