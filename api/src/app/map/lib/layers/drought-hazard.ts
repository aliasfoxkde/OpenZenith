import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addDroughtHazard(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("drought-hazard")) return;
  try {
    map.addSource("drought-hazard", { type: "raster", tiles: ["/api/drought-hazard/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 8 });
    map.addLayer({ id: "drought-hazard-raster", type: "raster", source: "drought-hazard", paint: { "raster-opacity": 0.8 } });
    setStatus(handle, "droughtHazard", "loaded");
  } catch { setStatus(handle, "droughtHazard", "error"); }
}
export function removeDroughtHazard(map: maplibregl.Map): void {
  try { map.removeLayer("drought-hazard-raster"); } catch {}
  try { map.removeSource("drought-hazard"); } catch {}
}
