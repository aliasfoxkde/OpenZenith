import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addFloodHazard(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("flood-hazard")) return;
  try {
    map.addSource("flood-hazard", { type: "raster", tiles: ["/api/flood-hazard/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 8 });
    map.addLayer({ id: "flood-hazard-raster", type: "raster", source: "flood-hazard", paint: { "raster-opacity": 0.8 } });
    setStatus(handle, "floodHazard", "loaded");
  } catch { setStatus(handle, "floodHazard", "error"); }
}
export function removeFloodHazard(map: maplibregl.Map): void {
  try { map.removeLayer("flood-hazard-raster"); } catch {}
  try { map.removeSource("flood-hazard"); } catch {}
}
