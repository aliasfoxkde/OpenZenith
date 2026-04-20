import type { LayerHandle } from "./types";

/* ─── Hillshade (terrain overlay) ─── */

export function addHillshade(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getLayer("hillshade-base")) return;
  if (!map.getSource("elevation")) return;

  // Primary hillshade — full detail, dark shadows for multiply-like effect on satellite
  map.addLayer({
    id: "hillshade-base",
    type: "hillshade",
    source: "elevation",
    paint: {
      "hillshade-shadow-color": "#0a0a0a",
      "hillshade-highlight-color": "#c8c8c8",
      "hillshade-accent-color": "#666666",
      "hillshade-exaggeration": 0.6,
    },
  });

  // Secondary hillshade — higher exaggeration, very subtle, adds micro-detail
  map.addLayer({
    id: "hillshade-detail",
    type: "hillshade",
    source: "elevation",
    paint: {
      "hillshade-shadow-color": "#000000",
      "hillshade-highlight-color": "#ffffff",
      "hillshade-accent-color": "#444444",
      "hillshade-exaggeration": 1.2,
    },
  });

  // Reduce opacity of the detail layer so it doesn't overwhelm
  try {
    map.setPaintProperty("hillshade-detail", "hillshade-opacity", 0.35);
  } catch { /* not all MapLibre versions support this */ }
}

export function removeHillshade(map: maplibregl.Map): void {
  try { map.removeLayer("hillshade-detail"); } catch {}
  try { map.removeLayer("hillshade-base"); } catch {}
}
