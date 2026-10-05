import type { LayerHandle } from "./types";

/* ─── Elevation Color Heatmap ─── */

/**
 * Add the colour-ramped elevation raster: a 256px source at
 * /api/elevation-color/{z}/{x}/{y} — SRTM 30m chunks mapped onto a
 * hypsometric colour ramp — drawn at 0.75 opacity, zooms 7-12. No status is
 * written to the handle; reorderMapLayers keeps this layer just above the
 * bathymetry overlay, which shares the same tile route.
 */
export function addElevationColor(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("elevation-color")) return;

  map.addSource("elevation-color", {
    type: "raster",
    tiles: ["/api/elevation-color/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 7,
    maxzoom: 12,
  });

  map.addLayer({
    id: "elevation-color-layer",
    type: "raster",
    source: "elevation-color",
    paint: {
      "raster-opacity": 0.75,
    },
  });
}

/** Remove the elevation-colour raster layer and its `elevation-color` source, ignoring "not found" errors. */
export function removeElevationColor(map: maplibregl.Map): void {
  try {
    map.removeLayer("elevation-color-layer");
  } catch {}
  try {
    map.removeSource("elevation-color");
  } catch {}
}
