import type { LayerHandle } from "./types";

/* ─── Elevation Accuracy Heatmap ─── */

// Store marker references for cleanup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let accuracyMarkers: any[] = [];

const ZONE_LABELS = [
  { text: "ArcticDEM 2m", lng: 40, lat: 73, color: "#00d2e6" },
  { text: "REMA 2m", lng: 0, lat: -73, color: "#00d2e6" },
  { text: "EEA 10m", lng: 15, lat: 52, color: "#22c55e" },
  { text: "SRTM / GLO-30 30m", lng: -80, lat: 38, color: "#228b22" },
  { text: "GLO-90 90m", lng: 110, lat: 5, color: "#9acd32" },
  { text: "GEBCO 450m", lng: -40, lat: 15, color: "#2171b5" },
  { text: "GEBCO 450m", lng: 60, lat: -30, color: "#2171b5" },
  { text: "GEBCO 450m", lng: 170, lat: 40, color: "#2171b5" },
  { text: "GEBCO 450m", lng: -150, lat: -20, color: "#2171b5" },
];

/**
 * Zone boundary lines matching the tile generation logic in
 * api/elevation-accuracy/[z]/[x]/[y]/route.ts
 */
const ZONE_BOUNDARIES: Array<{
  name: string;
  color: string;
  dash?: number[];
  coordinates: number[][];
}> = [
  // ArcticDEM zone: lat > 60°N
  {
    name: "ArcticDEM (60°N)",
    color: "#00d2e6",
    dash: [4, 2],
    coordinates: [
      [-180, 60], [-90, 60], [0, 60], [90, 60], [180, 60],
    ],
  },
  // REMA zone: lat < -60°S
  {
    name: "REMA (60°S)",
    color: "#00d2e6",
    dash: [4, 2],
    coordinates: [
      [-180, -60], [-90, -60], [0, -60], [90, -60], [180, -60],
    ],
  },
  // EEA 10m Europe box: lat 34-72, lon -25 to 45
  {
    name: "EEA 10m",
    color: "#22c55e",
    dash: [3, 3],
    coordinates: [
      [-25, 34], [-25, 72], [45, 72], [45, 34], [-25, 34],
    ],
  },
  // SRTM ±60° boundaries (already covered by ArcticDEM/REMA lines, but add visual emphasis)
  // SRTM northern boundary is same as ArcticDEM (60°N) — skip duplicate
  // SRTM southern boundary is same as REMA (60°S) — skip duplicate
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

  // Zone boundary lines — match actual tile generation thresholds
  const boundaryFeatures: GeoJSON.Feature[] = ZONE_BOUNDARIES.map((b) => ({
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: b.coordinates,
    },
    properties: { name: b.name },
  }));

  map.addSource("accuracy-boundaries", {
    type: "geojson",
    data: { type: "FeatureCollection", features: boundaryFeatures },
  });

  // Draw each boundary as its own layer for per-line styling
  for (let i = 0; i < ZONE_BOUNDARIES.length; i++) {
    const b = ZONE_BOUNDARIES[i];
    map.addLayer({
      id: `accuracy-boundary-${i}`,
      type: "line",
      source: "accuracy-boundaries",
      filter: ["==", ["get", "name"], b.name],
      paint: {
        "line-color": b.color,
        "line-width": 2,
        "line-opacity": 0.8,
        "line-dasharray": b.dash || [1],
      },
    });
  }

  // Also add coastline as a secondary reference (where land meets ocean = GEBCO boundary)
  map.addSource("accuracy-coastline", {
    type: "geojson",
    data: "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_coastline.geojson",
  });
  map.addLayer({
    id: "accuracy-coastline-line",
    type: "line",
    source: "accuracy-coastline",
    paint: {
      "line-color": "rgba(255, 255, 255, 0.25)",
      "line-width": 0.8,
      "line-opacity": 0.4,
    },
  });

  // HTML marker labels — always visible, no font dependency
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
  // Remove markers
  for (const m of accuracyMarkers) {
    m.remove();
  }
  accuracyMarkers = [];

  // Remove boundary layers (dynamic count)
  for (let i = 0; i < 10; i++) {
    try { map.removeLayer(`accuracy-boundary-${i}`); } catch {}
  }
  try { map.removeSource("accuracy-boundaries"); } catch {}
  try { map.removeLayer("accuracy-coastline-line"); } catch {}
  try { map.removeSource("accuracy-coastline"); } catch {}

  try { map.removeLayer("elevation-accuracy-edges"); } catch {}
  try { map.removeLayer("elevation-accuracy-layer"); } catch {}
  try { map.removeSource("elevation-accuracy"); } catch {}
}
