import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the ocean-colour overlay: a 256px raster source at
 * /api/chlorophyll/{z}/{x}/{y} (NASA GIBS MODIS Aqua chlorophyll-a
 * concentration, zooms 0-7) drawn at 0.85 opacity. Idempotent on the
 * `chlorophyll` source; reports "loaded"/"error" on the handle under the
 * "chlorophyll" id.
 */
export function addChlorophyll(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("chlorophyll")) return;
  try {
    map.addSource("chlorophyll", {
      type: "raster",
      tiles: ["/api/chlorophyll/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 7,
    });
    map.addLayer({
      id: "chlorophyll-raster",
      type: "raster",
      source: "chlorophyll",
      paint: { "raster-opacity": 0.85 },
    });
    setStatus(handle, "chlorophyll", "loaded");
  } catch (err) {
    warnLayerError("chlorophyll", err);
    setStatus(handle, "chlorophyll", "error");
    }
}
/** Remove the chlorophyll raster layer and its `chlorophyll` source, ignoring "not found" errors. */
export function removeChlorophyll(map: maplibregl.Map): void {
  try {
    map.removeLayer("chlorophyll-raster");
  } catch {}
  try {
    map.removeSource("chlorophyll");
  } catch {}
}
