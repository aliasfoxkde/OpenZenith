import type { LayerHandle } from "./types";

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

  // Base fill — subtle, transparent
  map.addLayer({
    id: "elevation-accuracy-layer",
    type: "raster",
    source: "elevation-accuracy",
    paint: {
      "raster-opacity": 0.2,
      "raster-saturation": 0.5,
    },
  });

  // Edge/contour overlay — high saturation, low opacity, shows zone boundaries
  map.addLayer({
    id: "elevation-accuracy-edges",
    type: "raster",
    source: "elevation-accuracy",
    paint: {
      "raster-opacity": 0.12,
      "raster-contrast": 2.5,
      "raster-saturation": 3,
      "raster-brightness-max": 0.6,
      "raster-brightness-min": 0.2,
    },
  });
}

export function removeElevationAccuracy(map: maplibregl.Map): void {
  try { map.removeLayer("elevation-accuracy-edges"); } catch {}
  try { map.removeLayer("elevation-accuracy-layer"); } catch {}
  try { map.removeSource("elevation-accuracy"); } catch {}
}
