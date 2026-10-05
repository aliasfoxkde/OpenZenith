import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the PM2.5 particulate-matter overlay: a 256px raster source at
 * /api/pm25/{z}/{x}/{y} (NASA GIBS Particulate Matter < 2.5um multi-year
 * mean, zooms 0-5) drawn at 0.8 opacity. Idempotent on the `pm25` source and
 * reports "loaded"/"error" on the handle under the "pm25" id; tile requests
 * are issued by MapLibre, not here.
 */
export function addPM25(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("pm25")) return;
  try {
    map.addSource("pm25", { type: "raster", tiles: ["/api/pm25/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 5 });
    map.addLayer({ id: "pm25-raster", type: "raster", source: "pm25", paint: { "raster-opacity": 0.8 } });
    setStatus(handle, "pm25", "loaded");
  } catch (err) {
    warnLayerError("pm25", err);
    setStatus(handle, "pm25", "error");
    }
}
/** Remove the PM2.5 raster layer and its `pm25` source, ignoring "not found" errors. */
export function removePM25(map: maplibregl.Map): void {
  try {
    map.removeLayer("pm25-raster");
  } catch {}
  try {
    map.removeSource("pm25");
  } catch {}
}
