import type { LayerHandle } from "./types";

/* ─── Hillshade (terrain overlay) ─── */

export function addHillshade(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getLayer("hillshade-base")) return;
  if (!map.getSource("elevation")) return;

  // Single hillshade layer — soft shadows to avoid tile boundary artifacts
  map.addLayer({
    id: "hillshade-base",
    type: "hillshade",
    source: "elevation",
    paint: {
      "hillshade-shadow-color": "#1a1a2e",
      "hillshade-highlight-color": "#c0c0d0",
      "hillshade-accent-color": "#606080",
      "hillshade-exaggeration": 0.5,
    },
  });
}

export function removeHillshade(map: maplibregl.Map): void {
  try { map.removeLayer("hillshade-base"); } catch {}
  try { map.removeLayer("hillshade-detail"); } catch {}
}
