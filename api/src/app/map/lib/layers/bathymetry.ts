import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── Bathymetry (Ocean Depth) ─── */

/**
 * Add the ocean-depth tint: a 256px raster source at
 * /api/elevation-color/{z}/{x}/{y} — the same colour-ramped DEM tiles the
 * elevation-colour layer uses, zooms 0-10 — rendered with desaturation,
 * +0.3 contrast and a compressed brightness band (0.3-0.75) at 0.55 opacity
 * so it reads as water shading. Reports "loaded"/"error" under the
 * "bathymetry" id; unlike most loaders here it does not early-return, so
 * re-adding after a removal re-registers cleanly.
 */
export function addBathymetry(map: maplibregl.Map, handle: LayerHandle): void {
  try {
    if (!map.getSource("bathymetry")) {
      map.addSource("bathymetry", {
        type: "raster",
        tiles: ["/api/elevation-color/{z}/{x}/{y}"],
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
          "raster-opacity": 0.55,
          "raster-saturation": 0.3,
          "raster-contrast": 0.3,
          "raster-brightness-max": 0.75,
          "raster-brightness-min": 0.3,
        },
      });
    }
    setStatus(handle, "bathymetry", "loaded");
  } catch (err) {
    warnLayerError("bathymetry", err);
    setStatus(handle, "bathymetry", "error");
    }
}

/** Remove the bathymetry raster layer and its `bathymetry` source, ignoring "not found" errors. */
export function removeBathymetry(map: maplibregl.Map): void {
  try {
    map.removeLayer("bathymetry");
  } catch {}
  try {
    map.removeSource("bathymetry");
  } catch {}
}
