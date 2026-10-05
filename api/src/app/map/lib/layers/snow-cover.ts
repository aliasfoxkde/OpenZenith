import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the snow-extent overlay: a 256px raster source at
 * /api/snow-cover/{z}/{x}/{y} (NASA GIBS MODIS Terra 8-day snow cover,
 * zooms 0-8) drawn at 0.8 opacity. Idempotent on the `snow-cover` source;
 * status goes to the handle under the camelCase id "snowCover".
 */
export function addSnowCover(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("snow-cover")) return;
  try {
    map.addSource("snow-cover", {
      type: "raster",
      tiles: ["/api/snow-cover/{z}/{x}/{y}"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 8,
    });
    map.addLayer({ id: "snow-cover-raster", type: "raster", source: "snow-cover", paint: { "raster-opacity": 0.8 } });
    setStatus(handle, "snowCover", "loaded");
  } catch (err) {
    warnLayerError("snowCover", err);
    setStatus(handle, "snowCover", "error");
    }
}
/** Remove the snow-cover raster layer and its `snow-cover` source, ignoring "not found" errors. */
export function removeSnowCover(map: maplibregl.Map): void {
  try {
    map.removeLayer("snow-cover-raster");
  } catch {}
  try {
    map.removeSource("snow-cover");
  } catch {}
}
