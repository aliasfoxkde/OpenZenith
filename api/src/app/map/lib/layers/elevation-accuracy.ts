import type { LayerHandle } from "./types";

/* ─── Elevation Accuracy Heatmap ─── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let accuracyMarkers: any[] = [];

/**
 * Zone labels placed at representative positions within each accuracy zone.
 * Colors match the tile colors from the server-side accuracy endpoint.
 */
const ZONE_LABELS = [
  { text: "ArcticDEM 2m", lng: -42, lat: 72, color: "#00d2e6" },
  { text: "REMA 2m", lng: 0, lat: -73, color: "#00d2e6" },
  { text: "EEA 10m", lng: 10, lat: 55, color: "#22c55e" },
  { text: "SRTM / GLO-30 30m", lng: -90, lat: 38, color: "#228b22" },
  { text: "SRTM / GLO-30 30m", lng: 80, lat: 30, color: "#228b22" },
  { text: "GLO-90 90m", lng: 100, lat: 10, color: "#9acd32" },
  { text: "Ocean — GEBCO 450m", lng: -30, lat: 20, color: "#2171b5" },
  { text: "Ocean — GEBCO 450m", lng: 70, lat: -25, color: "#2171b5" },
  { text: "Ocean — GEBCO 450m", lng: 160, lat: 30, color: "#2171b5" },
  { text: "Ocean — GEBCO 450m", lng: -130, lat: -15, color: "#2171b5" },
  { text: "Land", lng: -95, lat: 45, color: "#228b22" },
  { text: "Ocean", lng: -40, lat: 45, color: "#2171b5" },
];

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
      coordinates: [[-25, 34], [-25, 72], [45, 72], [45, 34], [-25, 34]],
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

  // Labels
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MlglMarker = (map as any).constructor as typeof maplibregl.Marker;
  for (const zone of ZONE_LABELS) {
    const el = document.createElement("div");
    el.textContent = zone.text;
    el.style.cssText = `
      color: ${zone.color};
      font-size: 11px;
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, monospace;
      text-shadow: 0 0 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.6);
      white-space: nowrap;
      pointer-events: none;
      opacity: 0.85;
    `;
    const marker = new MlglMarker({ element: el, anchor: "center" })
      .setLngLat([zone.lng, zone.lat])
      .addTo(map);
    accuracyMarkers.push(marker);
  }
}

export function removeElevationAccuracy(map: maplibregl.Map): void {
  for (const m of accuracyMarkers) { m.remove(); }
  accuracyMarkers = [];

  try { map.removeLayer("accuracy-zones-line"); } catch {}
  try { map.removeSource("accuracy-zones"); } catch {}
  try { map.removeLayer("accuracy-coastline-line"); } catch {}
  try { map.removeSource("accuracy-coastline"); } catch {}
  try { map.removeLayer("elevation-accuracy-edges"); } catch {}
  try { map.removeLayer("elevation-accuracy-layer"); } catch {}
  try { map.removeSource("elevation-accuracy"); } catch {}
}
