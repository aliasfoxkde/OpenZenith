import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── SAR Backscatter (OPERA L2 RTC Sentinel-1) ─── */

/**
 * Add the OPERA L2 RTC SAR-backscatter raster (Sentinel-1 radar reflectivity
 * via /api/sar-backscatter/{z}/{x}/{y}, zooms 1-10) at 0.85 opacity.
 * Guarded per source/layer; status is reported under the camelCase id
 * "sarBackscatter".
 */
export function addSarBackscatter(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("sar-backscatter")) return;

  try {
    if (!map.getSource("sar-backscatter")) {
      map.addSource("sar-backscatter", {
        type: "raster",
        tiles: ["/api/sar-backscatter/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 1,
        maxzoom: 10,
      });
    }
    if (!map.getLayer("sar-backscatter-raster")) {
      map.addLayer({
        id: "sar-backscatter-raster",
        type: "raster",
        source: "sar-backscatter",
        paint: {
          "raster-opacity": 0.85,
        },
      });
    }
    setStatus(handle, "sarBackscatter", "loaded");
  } catch (err) {
    warnLayerError("sarBackscatter", err);
    setStatus(handle, "sarBackscatter", "error");
    }
}

/** Remove the SAR-backscatter raster layer and its `sar-backscatter` source, ignoring "not found" errors. */
export function removeSarBackscatter(map: maplibregl.Map): void {
  try {
    map.removeLayer("sar-backscatter-raster");
  } catch {}
  try {
    map.removeSource("sar-backscatter");
  } catch {}
}
