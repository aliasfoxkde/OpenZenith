import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── NDVI (MODIS Terra L3 16-Day) ─── */

/**
 * Add the NDVI vegetation-index raster: a 256px source at
 * /api/ndvi/{z}/{x}/{y} (NASA GIBS MODIS Terra 16-day NDVI, zooms 0-9) at
 * 0.85 opacity. Guarded per source/layer; reports "loaded"/"error" under
 * the "ndvi" id.
 */
export function addNdvi(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("ndvi")) return;

  try {
    if (!map.getSource("ndvi")) {
      map.addSource("ndvi", {
        type: "raster",
        tiles: ["/api/ndvi/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 9,
      });
    }
    if (!map.getLayer("ndvi-raster")) {
      map.addLayer({
        id: "ndvi-raster",
        type: "raster",
        source: "ndvi",
        paint: { "raster-opacity": 0.85 },
      });
    }
    setStatus(handle, "ndvi", "loaded");
  } catch (err) {
    warnLayerError("ndvi", err);
    setStatus(handle, "ndvi", "error");
    }
}

/** Remove the NDVI raster layer and its `ndvi` source, ignoring "not found" errors. */
export function removeNdvi(map: maplibregl.Map): void {
  try {
    map.removeLayer("ndvi-raster");
  } catch {}
  try {
    map.removeSource("ndvi");
  } catch {}
}
