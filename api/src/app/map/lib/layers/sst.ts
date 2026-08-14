import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addSST(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("sst")) return;
  try {
    map.addSource("sst", { type: "raster", tiles: ["/api/sst/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 8 });
    map.addLayer({ id: "sst-raster", type: "raster", source: "sst", paint: { "raster-opacity": 0.85 } });
    setStatus(handle, "sst", "loaded");
  } catch {
    setStatus(handle, "sst", "error");
  }
}
export function removeSST(map: maplibregl.Map): void {
  try {
    map.removeLayer("sst-raster");
  } catch {}
  try {
    map.removeSource("sst");
  } catch {}
}
