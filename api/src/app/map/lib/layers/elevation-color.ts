import type { LayerHandle } from "./types";

/* ─── Elevation Color Heatmap ─── */

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

export function removeElevationColor(map: maplibregl.Map): void {
  try {
    map.removeLayer("elevation-color-layer");
  } catch {}
  try {
    map.removeSource("elevation-color");
  } catch {}
}
