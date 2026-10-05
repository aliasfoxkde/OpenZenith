import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the sea-surface-height-anomaly overlay: a 256px raster source at
 * /api/sea-height/{z}/{x}/{y} (NASA GIBS JPL MEaSUREs L4 daily anomalies,
 * zooms 0-6) drawn at 0.85 opacity. Idempotent on the `sea-height` source;
 * status is reported on the handle under the camelCase id "seaHeight" (not
 * the source id), as "loaded" or "error".
 */
export function addSeaHeight(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("sea-height")) return;
  try {
    map.addSource("sea-height", {
      type: "raster",
      tiles: ["/api/sea-height/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 6,
    });
    map.addLayer({ id: "sea-height-raster", type: "raster", source: "sea-height", paint: { "raster-opacity": 0.85 } });
    setStatus(handle, "seaHeight", "loaded");
  } catch (err) {
    warnLayerError("seaHeight", err);
    setStatus(handle, "seaHeight", "error");
    }
}
/** Remove the sea-height raster layer and its `sea-height` source, ignoring "not found" errors. */
export function removeSeaHeight(map: maplibregl.Map): void {
  try {
    map.removeLayer("sea-height-raster");
  } catch {}
  try {
    map.removeSource("sea-height");
  } catch {}
}
