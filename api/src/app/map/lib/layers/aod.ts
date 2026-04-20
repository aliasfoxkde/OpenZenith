import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addAOD(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("aod")) return;
  try {
    map.addSource("aod", { type: "raster", tiles: ["/api/aod/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 5 });
    map.addLayer({ id: "aod-raster", type: "raster", source: "aod", paint: { "raster-opacity": 0.8 } });
    setStatus(handle, "aod", "loaded");
  } catch { setStatus(handle, "aod", "error"); }
}
export function removeAOD(map: maplibregl.Map): void {
  try { map.removeLayer("aod-raster"); } catch {}
  try { map.removeSource("aod"); } catch {}
}
