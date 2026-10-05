import type { LayerHandle } from "./types";

/* ─── CORINE Land Cover ─── */

/**
 * Add the land-cover raster: a 256px source at /api/landcover/{z}/{x}/{y}
 * (NASA GIBS MODIS IGBP land-cover classification, zooms 4-13) drawn at 0.5
 * opacity so the basemap shows through. No status is written to the handle.
 */
export function addLandCover(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("land-cover")) return;

  map.addSource("land-cover", {
    type: "raster",
    tiles: ["/api/landcover/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 4,
    maxzoom: 13,
  });

  map.addLayer({
    id: "land-cover-layer",
    type: "raster",
    source: "land-cover",
    paint: {
      "raster-opacity": 0.5,
    },
  });
}

/** Remove the land-cover raster layer and its `land-cover` source, ignoring "not found" errors. */
export function removeLandCover(map: maplibregl.Map): void {
  try {
    map.removeLayer("land-cover-layer");
  } catch {}
  try {
    map.removeSource("land-cover");
  } catch {}
}
