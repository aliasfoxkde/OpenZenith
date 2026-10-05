import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── SAR Backscatter (OPERA L2 RTC Sentinel-1) ─── */

const sarbackscatterSpec: RasterLayerSpec = {
  sourceId: "sar-backscatter",
  tiles: ["/api/sar-backscatter/{z}/{x}/{y}"],
  opacity: 0.85,
  minzoom: 1,
  maxzoom: 10,
  statusId: "sarBackscatter",
};

/**
 * Add the sar-backscatter raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "sarBackscatter" id.
 */
export function addSarBackscatter(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, sarbackscatterSpec);
}
/** Remove the sar-backscatter raster layer and its source, ignoring errors. */
export function removeSarBackscatter(map: maplibregl.Map): void {
  removeRasterLayer(map, "sar-backscatter");
}
