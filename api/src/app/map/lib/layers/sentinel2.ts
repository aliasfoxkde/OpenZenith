import type { LayerHandle } from "./types";

/* ─── Sentinel-2 Imagery ─── */

/**
 * Add the Sentinel-2 true-colour basemap raster: a 256px source at
 * /api/sentinel2/{z}/{x}/{y} (Planetary Computer STAC + TiTiler COG tiles with a GIBS fallback, zooms
 * 3-14) drawn at 0.8 opacity with +0.3 raster-saturation. No status is
 * written to the handle.
 */
export function addSentinel2(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("sentinel2")) return;

  map.addSource("sentinel2", {
    type: "raster",
    tiles: ["/api/sentinel2/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 3,
    maxzoom: 14,
  });

  map.addLayer({
    id: "sentinel2-layer",
    type: "raster",
    source: "sentinel2",
    paint: {
      "raster-opacity": 0.8,
      "raster-saturation": 0.3,
    },
  });
}

/** Remove the Sentinel-2 raster layer and its `sentinel2` source, ignoring "not found" errors. */
export function removeSentinel2(map: maplibregl.Map): void {
  try {
    map.removeLayer("sentinel2-layer");
  } catch {}
  try {
    map.removeSource("sentinel2");
  } catch {}
}
