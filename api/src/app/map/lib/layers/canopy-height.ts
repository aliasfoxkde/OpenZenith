import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addCanopyHeight(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("canopy-height")) return;
  try {
    map.addSource("canopy-height", {
      type: "raster",
      tiles: ["/api/canopy-height/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 8,
    });
    map.addLayer({
      id: "canopy-height-raster",
      type: "raster",
      source: "canopy-height",
      paint: { "raster-opacity": 0.85 },
    });
    setStatus(handle, "canopyHeight", "loaded");
  } catch {
    setStatus(handle, "canopyHeight", "error");
  }
}
export function removeCanopyHeight(map: maplibregl.Map): void {
  try {
    map.removeLayer("canopy-height-raster");
  } catch {}
  try {
    map.removeSource("canopy-height");
  } catch {}
}
