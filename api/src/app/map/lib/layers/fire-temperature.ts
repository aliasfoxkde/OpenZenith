import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── Fire Temperature (GOES-East ABI Fire Temperature) ─── */

/**
 * Add the GOES-East ABI fire-temperature raster: a 256px source at
 * /api/fire-temperature/{z}/{x}/{y} (zooms 1-9, North/Central America only)
 * at 0.8 opacity. Guarded per source/layer; status is reported under the
 * camelCase id "fireTemperature".
 */
export function addFireTemperature(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("fire-temperature")) return;

  try {
    if (!map.getSource("fire-temperature")) {
      map.addSource("fire-temperature", {
        type: "raster",
        tiles: ["/api/fire-temperature/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 1,
        maxzoom: 9,
      });
    }
    if (!map.getLayer("fire-temperature-raster")) {
      map.addLayer({
        id: "fire-temperature-raster",
        type: "raster",
        source: "fire-temperature",
        paint: {
          "raster-opacity": 0.8,
        },
      });
    }
    setStatus(handle, "fireTemperature", "loaded");
  } catch (err) {
    warnLayerError("fireTemperature", err);
    setStatus(handle, "fireTemperature", "error");
    }
}

/** Remove the fire-temperature raster layer and its `fire-temperature` source, ignoring "not found" errors. */
export function removeFireTemperature(map: maplibregl.Map): void {
  try {
    map.removeLayer("fire-temperature-raster");
  } catch {}
  try {
    map.removeSource("fire-temperature");
  } catch {}
}
