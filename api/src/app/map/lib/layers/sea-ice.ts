import type { LayerHandle } from "./types";

/* ─── Sea Ice (OSI SAF — Ocean and Sea Ice Satellite Application Facility) ─── */

/**
 * Add the sea-ice-concentration raster, pointing MapLibre straight at an
 * NSIDC THREDDS WMS endpoint ({bbox-epsg-3857} template, 256px, zooms 0-8,
 * attribution on the source) at 0.7 opacity. This is the one layer that
 * bypasses the app's own tile proxy, so browser CORS and upstream availability
 * decide whether anything renders. No status is written to the handle.
 */
export function addSeaIce(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("seaIce")) return;

  // OSI SAF provides sea ice concentration via WMS
  // Using a free tile endpoint from the Norwegian Meteorological Institute
  const _tileUrl =
    "https://thredds.met.no/thredds/wms/sea_ice/topaz?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ice_concentration&FORMAT=image/png&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}";

  try {
    if (!map.getSource("seaIce")) {
      map.addSource("seaIce", {
        type: "raster",
        tiles: [
          // Using a simpler tile URL pattern
          "https://polar.nsidc.org/thredds/wms/NSIDC0051_SEAICE_PS_N25km/agger?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=sic&FORMAT=image/png&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}",
        ],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 8,
        attribution: "NSIDC Sea Ice / OSI SAF",
      });
    }

    if (!map.getLayer("seaIce-raster")) {
      map.addLayer({
        id: "seaIce-raster",
        type: "raster",
        source: "seaIce",
        paint: {
          "raster-opacity": 0.7,
        },
      });
    }
  } catch {
    /* source/layer may already exist */
  }
}

/** Remove the sea-ice raster layer and its `seaIce` source, ignoring "not found" errors. */
export function removeSeaIce(map: maplibregl.Map): void {
  try {
    map.removeLayer("seaIce-raster");
  } catch {}
  try {
    map.removeSource("seaIce");
  } catch {}
}
