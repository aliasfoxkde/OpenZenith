import type { LayerHandle } from "./types";

/* ─── Elevation Accuracy Heatmap ─── */

/**
 * Only the EEA 10m bounding box is a clean geographic boundary.
 * The 60°N/60°S lines are NOT drawn because they don't align with
 * tile colors — the tiles use a land mask, so ocean at 60°N is
 * still GEBCO blue, not ArcticDEM cyan.
 */
const ZONE_BOUNDARIES: GeoJSON.Feature[] = [
  {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [-25, 34],
        [-25, 72],
        [45, 72],
        [45, 34],
        [-25, 34],
      ],
    },
    properties: { zone: "EEA" },
  },
];

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
    paint: { "raster-opacity": 0.25, "raster-saturation": 0.5 },
  });

  // EEA 10m bounding box (the only clean geographic boundary)
  map.addSource("accuracy-zones", {
    type: "geojson",
    data: { type: "FeatureCollection", features: ZONE_BOUNDARIES },
  });

  map.addLayer({
    id: "accuracy-zones-line",
    type: "line",
    source: "accuracy-zones",
    paint: {
      "line-color": "#22c55e",
      "line-width": 1.5,
      "line-opacity": 0.6,
      "line-dasharray": [6, 3],
    },
  });

  // Coastline — land/ocean boundary from Natural Earth
  map.addSource("accuracy-coastline", {
    type: "geojson",
    data: "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_coastline.geojson",
  });
  map.addLayer({
    id: "accuracy-coastline-line",
    type: "line",
    source: "accuracy-coastline",
    paint: {
      "line-color": "rgba(255, 255, 255, 0.5)",
      "line-width": 1.2,
      "line-opacity": 0.6,
    },
  });

  // Labels are intentionally omitted here. The loader only receives a Map
  // instance, and constructing a Marker from `map.constructor` is invalid in
  // MapLibre. The legend already explains these zones; a future label layer
  // should receive the actual MapLibre module explicitly.
}

export function removeElevationAccuracy(map: maplibregl.Map): void {
  try {
    map.removeLayer("accuracy-zones-line");
  } catch {}
  try {
    map.removeSource("accuracy-zones");
  } catch {}
  try {
    map.removeLayer("accuracy-coastline-line");
  } catch {}
  try {
    map.removeSource("accuracy-coastline");
  } catch {}
  try {
    map.removeLayer("elevation-accuracy-edges");
  } catch {}
  try {
    map.removeLayer("elevation-accuracy-layer");
  } catch {}
  try {
    map.removeSource("elevation-accuracy");
  } catch {}
}
