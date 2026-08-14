import type { LayerHandle } from "./types";
import { setStatus } from "./types";

export function addBiomass(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("biomass")) return;
  try {
    map.addSource("biomass", {
      type: "raster",
      tiles: ["/api/biomass/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 8,
    });
    map.addLayer({ id: "biomass-raster", type: "raster", source: "biomass", paint: { "raster-opacity": 0.85 } });
    setStatus(handle, "biomass", "loaded");
  } catch {
    setStatus(handle, "biomass", "error");
  }
}
export function removeBiomass(map: maplibregl.Map): void {
  try {
    map.removeLayer("biomass-raster");
  } catch {}
  try {
    map.removeSource("biomass");
  } catch {}
}
