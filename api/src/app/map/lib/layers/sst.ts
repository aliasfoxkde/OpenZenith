import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/**
 * Add the sea-surface-temperature overlay: a 256px raster source at
 * /api/sst/{z}/{x}/{y} (NASA GIBS GHRSST L4 MUR 1 km daily composite, zooms
 * 0-8) drawn at 0.85 opacity. Idempotent on the `sst` source; reports
 * "loaded"/"error" on the handle under the "sst" id.
 */
export function addSST(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("sst")) return;
  try {
    map.addSource("sst", { type: "raster", tiles: ["/api/sst/{z}/{x}/{y}"], tileSize: 256, minzoom: 0, maxzoom: 8 });
    map.addLayer({ id: "sst-raster", type: "raster", source: "sst", paint: { "raster-opacity": 0.85 } });
    setStatus(handle, "sst", "loaded");
  } catch (err) {
    warnLayerError("sst", err);
    setStatus(handle, "sst", "error");
    }
}
/** Remove the SST raster layer and its `sst` source, ignoring "not found" errors. */
export function removeSST(map: maplibregl.Map): void {
  try {
    map.removeLayer("sst-raster");
  } catch {}
  try {
    map.removeSource("sst");
  } catch {}
}
