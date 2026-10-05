import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the flood-hazard overlay: a 256px raster source at
 * /api/flood-hazard/{z}/{x}/{y} (NASA GIBS NDH flood hazard frequency,
 * 1985-2003, zooms 0-8) drawn at 0.8 opacity. Idempotent on the
 * `flood-hazard` source; status is reported under the camelCase id
 * "floodHazard".
 */
export function addFloodHazard(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("flood-hazard")) return;
  try {
    map.addSource("flood-hazard", {
      type: "raster",
      tiles: ["/api/flood-hazard/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 8,
    });
    map.addLayer({
      id: "flood-hazard-raster",
      type: "raster",
      source: "flood-hazard",
      paint: { "raster-opacity": 0.8 },
    });
    setStatus(handle, "floodHazard", "loaded");
  } catch (err) {
    warnLayerError("floodHazard", err);
    setStatus(handle, "floodHazard", "error");
  }
}
/** Remove the flood-hazard raster layer and its `flood-hazard` source, ignoring "not found" errors. */
export function removeFloodHazard(map: maplibregl.Map): void {
  try {
    map.removeLayer("flood-hazard-raster");
  } catch {}
  try {
    map.removeSource("flood-hazard");
  } catch {}
}
