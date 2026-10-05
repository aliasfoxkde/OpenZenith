import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the drought-hazard overlay: a 256px raster source at
 * /api/drought-hazard/{z}/{x}/{y} (NASA GIBS NDH drought hazard frequency,
 * 1980-2000, zooms 0-8) drawn at 0.8 opacity. Idempotent on the
 * `drought-hazard` source; status is reported under the camelCase id
 * "droughtHazard".
 */
export function addDroughtHazard(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("drought-hazard")) return;
  try {
    map.addSource("drought-hazard", {
      type: "raster",
      tiles: ["/api/drought-hazard/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 8,
    });
    map.addLayer({
      id: "drought-hazard-raster",
      type: "raster",
      source: "drought-hazard",
      paint: { "raster-opacity": 0.8 },
    });
    setStatus(handle, "droughtHazard", "loaded");
  } catch (err) {
    warnLayerError("droughtHazard", err);
    setStatus(handle, "droughtHazard", "error");
    }
}
/** Remove the drought-hazard raster layer and its `drought-hazard` source, ignoring "not found" errors. */
export function removeDroughtHazard(map: maplibregl.Map): void {
  try {
    map.removeLayer("drought-hazard-raster");
  } catch {}
  try {
    map.removeSource("drought-hazard");
  } catch {}
}
