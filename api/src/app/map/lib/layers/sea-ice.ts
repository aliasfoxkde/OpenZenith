import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Sea Ice (OSI SAF — Ocean and Sea Ice Satellite Application Facility) ─── */

const seaIceSpec: RasterLayerSpec = {
  sourceId: "seaIce",
  tiles: ["https://polar.nsidc.org/thredds/wms/NSIDC0051_SEAICE_PS_N25km/agger?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=sic&FORMAT=image/png&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}"],
  opacity: 0.7,
  minzoom: 0,
  maxzoom: 8,
  reportStatus: false,
  attribution: "NSIDC Sea Ice / OSI SAF",
};

/**
 * Add the seaIce raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). No status is written to the handle; failures are logged, not thrown.
 */
export function addSeaIce(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, seaIceSpec);
}
/** Remove the seaIce raster layer and its source, ignoring errors. */
export function removeSeaIce(map: maplibregl.Map): void {
  removeRasterLayer(map, "seaIce");
}
