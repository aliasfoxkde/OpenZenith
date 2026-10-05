import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the aerosol optical depth overlay: a 256px raster source at
 * /api/aod/{z}/{x}/{y} (NASA GIBS MODIS Aqua Deep Blue Combined, zooms 0-5)
 * drawn as a 0.8-opacity raster layer. Idempotent — returns early when the
 * `aod` source already exists — and reports "loaded" or "error" on the handle
 * under the "aod" id. Tiles are requested lazily by MapLibre, so no network
 * call happens here.
 */
export function addAOD(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("aod")) return;
  try {
    map.addSource("aod", { type: "raster", tiles: ["/api/aod/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 5 });
    map.addLayer({ id: "aod-raster", type: "raster", source: "aod", paint: { "raster-opacity": 0.8 } });
    setStatus(handle, "aod", "loaded");
  } catch (err) {
    warnLayerError("aod", err);
    setStatus(handle, "aod", "error");
    }
}
/** Remove the AOD raster layer and its `aod` source; both removals swallow "not found" errors. */
export function removeAOD(map: maplibregl.Map): void {
  try {
    map.removeLayer("aod-raster");
  } catch {}
  try {
    map.removeSource("aod");
  } catch {}
}
