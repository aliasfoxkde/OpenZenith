import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Sea Ice (NASA GIBS — AMSRU2 sea ice concentration) ─── */

const seaIceSpec: RasterLayerSpec = {
  sourceId: "seaIce",
  tiles: [
    "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=AMSRU2_Sea_Ice_Concentration_12km&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
  ],
  opacity: 0.7,
  minzoom: 0,
  maxzoom: 8,
  attribution: "© NASA GIBS / AMSRU2 Sea Ice Concentration",
};

/**
 * Add the seaIce raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above), reporting "loaded"/"error" on the
 * handle under the source id. The WMS request omits TIME, so GIBS serves the
 * latest day in the product's coverage — the tile URL stays a static template
 * MapLibre can fill per tile.
 */
export function addSeaIce(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, seaIceSpec);
}
/** Remove the seaIce raster layer and its source, ignoring errors. */
export function removeSeaIce(map: maplibregl.Map): void {
  removeRasterLayer(map, "seaIce");
}
