import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the above-ground biomass overlay: a 256px raster source at
 * /api/biomass/{z}/{x}/{y} (NASA GIBS GEDI L4B mean biomass density,
 * 2019-2023, zooms 0-8) drawn at 0.85 opacity. Idempotent on the `biomass`
 * source; reports "loaded"/"error" on the handle under the "biomass" id.
 */
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
  } catch (err) {
    warnLayerError("biomass", err);
    setStatus(handle, "biomass", "error");
    }
}
/** Remove the biomass raster layer and its `biomass` source, ignoring "not found" errors. */
export function removeBiomass(map: maplibregl.Map): void {
  try {
    map.removeLayer("biomass-raster");
  } catch {}
  try {
    map.removeSource("biomass");
  } catch {}
}
