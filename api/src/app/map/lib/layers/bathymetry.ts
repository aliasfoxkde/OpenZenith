import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Bathymetry (Ocean Depth) ─── */

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
  } catch {
    setStatus(handle, "bathymetry", "error");
  }
}

export function removeBathymetry(map: maplibregl.Map): void {
  try {
    map.removeLayer("bathymetry");
  } catch {}
  try {
    map.removeSource("bathymetry");
  } catch {}
}
