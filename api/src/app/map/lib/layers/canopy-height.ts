import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the canopy-height overlay: a 256px raster source at
 * /api/canopy-height/{z}/{x}/{y} (NASA GIBS GEDI L3 mean RH100 canopy height
 * in metres, 2019-2023, zooms 0-8) drawn at 0.85 opacity. Idempotent on the
 * `canopy-height` source; status is reported under the camelCase id
 * "canopyHeight".
 */
export function addCanopyHeight(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("canopy-height")) return;
  try {
    map.addSource("canopy-height", {
      type: "raster",
      tiles: ["/api/canopy-height/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 8,
    });
    map.addLayer({
      id: "canopy-height-raster",
      type: "raster",
      source: "canopy-height",
      paint: { "raster-opacity": 0.85 },
    });
    setStatus(handle, "canopyHeight", "loaded");
  } catch (err) {
    warnLayerError("canopyHeight", err);
    setStatus(handle, "canopyHeight", "error");
    }
}
/** Remove the canopy-height raster layer and its `canopy-height` source, ignoring "not found" errors. */
export function removeCanopyHeight(map: maplibregl.Map): void {
  try {
    map.removeLayer("canopy-height-raster");
  } catch {}
  try {
    map.removeSource("canopy-height");
  } catch {}
}
