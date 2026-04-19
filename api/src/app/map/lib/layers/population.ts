import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Population Density (GHSL) ─── */

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

export function removePopulationDensity(map: maplibregl.Map): void {
  try {
    map.removeLayer("population-density-layer");
  } catch {}
  try {
    map.removeSource("population-density");
  } catch {}
}
