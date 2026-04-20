import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addLandslideHazard(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("landslide-hazard")) return;
  try {
    map.addSource("landslide-hazard", { type: "raster", tiles: ["/api/landslide-hazard/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 8 });
    map.addLayer({ id: "landslide-hazard-raster", type: "raster", source: "landslide-hazard", paint: { "raster-opacity": 0.8 } });
    setStatus(handle, "landslideHazard", "loaded");
  } catch { setStatus(handle, "landslideHazard", "error"); }
}
export function removeLandslideHazard(map: maplibregl.Map): void {
  try { map.removeLayer("landslide-hazard-raster"); } catch {}
  try { map.removeSource("landslide-hazard"); } catch {}
}
