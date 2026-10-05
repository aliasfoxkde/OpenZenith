import type { LayerHandle } from "./types";

/* ─── Population Density (GHSL) ─── */

/**
 * Add the population-density raster: a 256px source at
 * /api/population/{z}/{x}/{y} (NASA GIBS VIIRS Black Marble as a settlement-density proxy, zooms 2-14)
 * drawn at 0.6 opacity with a raster-color-mix multiply that tints the tiles
 * toward amber. No status is written to the handle.
 */
export function addPopulationDensity(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("population-density")) return;

  map.addSource("population-density", {
    type: "raster",
    tiles: ["/api/population/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 2,
    maxzoom: 14,
  });

  map.addLayer({
    id: "population-density-layer",
    type: "raster",
    source: "population-density",
    paint: {
      "raster-opacity": 0.6,
      "raster-color-mix": ["multiply", ["rgba(0,0,0,0.7)"], ["rgba(255,200,0,1)"]],
    },
  });
}

/** Remove the population-density raster layer and its `population-density` source, ignoring "not found" errors. */
export function removePopulationDensity(map: maplibregl.Map): void {
  try {
    map.removeLayer("population-density-layer");
  } catch {}
  try {
    map.removeSource("population-density");
  } catch {}
}
