import type { LayerHandle } from "./types";

/* ─── Hillshade (terrain overlay) ─── */

export function addHillshade(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getLayer("hillshade-base")) return;
  if (!map.getSource("elevation")) return;

  // Single hillshade layer — soft colors, low exaggeration to minimize tile seam artifacts
  map.addLayer({
    id: "hillshade-base",
    type: "hillshade",
    source: "elevation",
    paint: {
      "hillshade-shadow-color": "rgba(0,0,0,0.35)",
      "hillshade-highlight-color": "rgba(255,255,255,0.55)",
      "hillshade-accent-color": "rgba(128,128,128,0.2)",
      "hillshade-exaggeration": 0.35,
    },
  });
}

export function removeHillshade(map: maplibregl.Map): void {
  try { map.removeLayer("hillshade-base"); } catch {}
  try { map.removeLayer("hillshade-detail"); } catch {}
}
