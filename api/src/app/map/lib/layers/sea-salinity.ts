import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the sea-surface-salinity overlay: a 256px raster source at
 * /api/sea-salinity/{z}/{x}/{y} (NASA GIBS SMAP L3 monthly salinity, zooms
 * 0-5) drawn at 0.85 opacity. Idempotent on the `sea-salinity` source;
 * status is reported under the camelCase id "seaSalinity".
 */
export function addSeaSalinity(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("sea-salinity")) return;
  try {
    map.addSource("sea-salinity", {
      type: "raster",
      tiles: ["/api/sea-salinity/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 5,
    });
    map.addLayer({
      id: "sea-salinity-raster",
      type: "raster",
      source: "sea-salinity",
      paint: { "raster-opacity": 0.85 },
    });
    setStatus(handle, "seaSalinity", "loaded");
  } catch (err) {
    warnLayerError("seaSalinity", err);
    setStatus(handle, "seaSalinity", "error");
  }
}
/** Remove the sea-salinity raster layer and its `sea-salinity` source, ignoring "not found" errors. */
export function removeSeaSalinity(map: maplibregl.Map): void {
  try {
    map.removeLayer("sea-salinity-raster");
  } catch {}
  try {
    map.removeSource("sea-salinity");
  } catch {}
}
