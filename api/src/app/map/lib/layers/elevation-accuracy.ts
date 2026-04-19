import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Elevation Accuracy Heatmap ─── */

export function addElevationAccuracy(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("elevation-accuracy")) return;

  map.addSource("elevation-accuracy", {
    type: "raster",
    tiles: ["/api/elevation-accuracy/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 12,
  });

  map.addLayer({
    id: "elevation-accuracy-layer",
    type: "raster",
    source: "elevation-accuracy",
    paint: {
      "raster-opacity": 0.4,
    },
  });
}

export function removeElevationAccuracy(map: maplibregl.Map): void {
  try {
    map.removeLayer("elevation-accuracy-layer");
  } catch {}
  try {
    map.removeSource("elevation-accuracy");
  } catch {}
}
