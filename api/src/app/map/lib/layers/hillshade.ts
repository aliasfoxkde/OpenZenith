import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Hillshade (terrain overlay) ─── */

export function addHillshade(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getLayer("hillshade")) return;
  if (!map.getSource("elevation")) return;
  map.addLayer({
    id: "hillshade",
    type: "hillshade",
    source: "elevation",
    paint: {
      "hillshade-shadow-color": "#000000",
      "hillshade-highlight-color": "#ffffff",
      "hillshade-accent-color": "#333333",
      "hillshade-exaggeration": 0.5,
    },
  });
}

export function removeHillshade(map: maplibregl.Map): void {
  try {
    map.removeLayer("hillshade");
  } catch {}
}
