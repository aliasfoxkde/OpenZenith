import type { LayerHandle } from "./types";

/* ─── Hillshade (terrain overlay) ─── */

export function addHillshade(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getLayer("hillshade")) return;
  if (!map.getSource("elevation")) return;
  map.addLayer({
    id: "hillshade",
    type: "hillshade",
    source: "elevation",
    paint: {
      "hillshade-shadow-color": "#1a1a1a",
      "hillshade-highlight-color": "#d0d0d0",
      "hillshade-accent-color": "#888888",
      "hillshade-exaggeration": 0.5,
    },
  });
}

export function removeHillshade(map: maplibregl.Map): void {
  try {
    map.removeLayer("hillshade");
  } catch {}
}
