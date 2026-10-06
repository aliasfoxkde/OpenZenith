import { removeLayerIfPresent } from "./types";
import type { LayerHandle } from "./types";

/* ─── Hillshade (terrain overlay) ─── */

/**
 * Add the terrain hillshade layer on top of the shared `elevation` DEM
 * source (created by addElevationSource): soft black/white shading at 0.35
 * exaggeration to keep tile seams invisible. Requires that source to exist —
 * the function silently does nothing when it is missing — and writes no
 * status to the handle.
 */
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

/** Remove the hillshade-base layer (and the legacy hillshade-detail id), leaving the `elevation` source in place for 3D terrain. */
export function removeHillshade(map: maplibregl.Map): void {
  removeLayerIfPresent(map, "hillshade-base");
  // Legacy id from a pre-2026-10 bundle; checked, not try/removed, because
  // MapLibre logs an ErrorEvent (not an exception) for missing layers.
  removeLayerIfPresent(map, "hillshade-detail");
}
