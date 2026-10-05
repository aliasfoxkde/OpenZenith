import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the landslide-hazard overlay: a 256px raster source at
 * /api/landslide-hazard/{z}/{x}/{y} (NASA GIBS NDH landslide hazard
 * distribution, 2000, zooms 0-8) drawn at 0.8 opacity. Idempotent on the
 * `landslide-hazard` source; status is reported under the camelCase id
 * "landslideHazard".
 */
export function addLandslideHazard(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("landslide-hazard")) return;
  try {
    map.addSource("landslide-hazard", {
      type: "raster",
      tiles: ["/api/landslide-hazard/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 8,
    });
    map.addLayer({
      id: "landslide-hazard-raster",
      type: "raster",
      source: "landslide-hazard",
      paint: { "raster-opacity": 0.8 },
    });
    setStatus(handle, "landslideHazard", "loaded");
  } catch (err) {
    warnLayerError("landslideHazard", err);
    setStatus(handle, "landslideHazard", "error");
    }
}
/** Remove the landslide-hazard raster layer and its `landslide-hazard` source, ignoring "not found" errors. */
export function removeLandslideHazard(map: maplibregl.Map): void {
  try {
    map.removeLayer("landslide-hazard-raster");
  } catch {}
  try {
    map.removeSource("landslide-hazard");
  } catch {}
}
