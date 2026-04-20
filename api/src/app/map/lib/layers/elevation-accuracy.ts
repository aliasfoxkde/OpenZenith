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

  // Coastline border — this IS the boundary between GEBCO ocean and land zones
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

  try { map.removeLayer("accuracy-coastline-line"); } catch {}
  try { map.removeSource("accuracy-coastline"); } catch {}
  try { map.removeLayer("elevation-accuracy-edges"); } catch {}
  try { map.removeLayer("elevation-accuracy-layer"); } catch {}
  try { map.removeSource("elevation-accuracy"); } catch {}
}
