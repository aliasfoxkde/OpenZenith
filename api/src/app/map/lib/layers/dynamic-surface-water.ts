import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── Dynamic Surface Water Extent (OPERA L3, Sentinel-1) ─── */

/**
 * Add the OPERA L3 dynamic surface-water extent raster (Sentinel-1 derived
 * flooding, via /api/dynamic-surface-water/{z}/{x}/{y}, zooms 0-9) at 0.85
 * opacity. Guarded per source/layer so a partial registration still
 * completes; reports "loaded"/"error" under the camelCase id
 * "dynamicSurfaceWater".
 */
export function addDynamicSurfaceWater(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("dynamic-surface-water")) return;

  try {
    if (!map.getSource("dynamic-surface-water")) {
      map.addSource("dynamic-surface-water", {
        type: "raster",
        tiles: ["/api/dynamic-surface-water/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 9,
      });
    }
    if (!map.getLayer("dynamic-surface-water-raster")) {
      map.addLayer({
        id: "dynamic-surface-water-raster",
        type: "raster",
        source: "dynamic-surface-water",
        paint: { "raster-opacity": 0.85 },
      });
    }
    setStatus(handle, "dynamicSurfaceWater", "loaded");
  } catch (err) {
    warnLayerError("dynamicSurfaceWater", err);
    setStatus(handle, "dynamicSurfaceWater", "error");
    }
}

/** Remove the dynamic-surface-water raster layer and its source, ignoring "not found" errors. */
export function removeDynamicSurfaceWater(map: maplibregl.Map): void {
  try {
    map.removeLayer("dynamic-surface-water-raster");
  } catch {}
  try {
    map.removeSource("dynamic-surface-water");
  } catch {}
}
