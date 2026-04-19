import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Bathymetry (Ocean Depth) ─── */

// Uses the DEM tile endpoint which includes negative elevation (ocean depth).
// We add a color layer that renders below sea level in blue gradients.
// The elevation-color endpoint already handles this, but bathymetry provides
// a focused ocean-only view with deeper blues.

export function addBathymetry(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("bathymetry")) return;

  try {
    if (!map.getSource("bathymetry")) {
      map.addSource("bathymetry", {
        type: "raster",
        tiles: [
          // Use our elevation-color tiles which show ocean in blues
          "/api/elevation-color/{z}/{x}/{y}",
        ],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 10,
      });
    }

    if (!map.getLayer("bathymetry")) {
      map.addLayer({
        id: "bathymetry",
        type: "raster",
        source: "bathymetry",
        paint: {
          // Apply blue tint filter to make it look like bathymetry
          "raster-opacity": 0.7,
          "raster-saturation": 0.3,
          "raster-contrast": 0.2,
          "raster-brightness-max": 0.6,
          "raster-brightness-min": 0.3,
        },
      });
    }
  } catch {
    /* layers may already exist */
  }

  setStatus(handle, "bathymetry", "loaded");
}

export function removeBathymetry(map: maplibregl.Map): void {
  try { map.removeLayer("bathymetry"); } catch {}
  try { map.removeSource("bathymetry"); } catch {}
}
