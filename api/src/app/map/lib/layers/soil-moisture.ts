import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── Soil Moisture (SMAP L3) ─── */

/**
 * Add the SMAP L3 soil-moisture raster: a 256px source at
 * /api/soil-moisture/{z}/{x}/{y} (L-band active retrieval, zooms 0-3 — the
 * coarsest of the GIBS overlays) at 0.85 opacity. Guarded per source/layer;
 * status is reported under the camelCase id "soilMoisture".
 */
export function addSoilMoisture(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("soil-moisture")) return;

  try {
    if (!map.getSource("soil-moisture")) {
      map.addSource("soil-moisture", {
        type: "raster",
        tiles: ["/api/soil-moisture/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 3,
      });
    }
    if (!map.getLayer("soil-moisture-raster")) {
      map.addLayer({
        id: "soil-moisture-raster",
        type: "raster",
        source: "soil-moisture",
        paint: { "raster-opacity": 0.85 },
      });
    }
    setStatus(handle, "soilMoisture", "loaded");
  } catch (err) {
    warnLayerError("soilMoisture", err);
    setStatus(handle, "soilMoisture", "error");
    }
}

/** Remove the soil-moisture raster layer and its `soil-moisture` source, ignoring "not found" errors. */
export function removeSoilMoisture(map: maplibregl.Map): void {
  try {
    map.removeLayer("soil-moisture-raster");
  } catch {}
  try {
    map.removeSource("soil-moisture");
  } catch {}
}
