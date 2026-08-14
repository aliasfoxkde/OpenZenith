import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Dynamic Surface Water Extent (OPERA L3, Sentinel-1) ─── */

export function addDynamicSurfaceWater(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("dynamic-surface-water")) return;

  try {
    if (!map.getSource("dynamic-surface-water")) {
      map.addSource("dynamic-surface-water", {
        type: "raster",
        tiles: ["/api/dynamic-surface-water/{z}/{x}/{y}"],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 9,
      });
    }
    if (!map.getLayer("dynamic-surface-water-raster")) {
      map.addLayer({
        id: "dynamic-surface-water-raster",
        type: "raster",
        source: "dynamic-surface-water",
        paint: { "raster-opacity": 0.85 },
      });
    }
    setStatus(handle, "dynamicSurfaceWater", "loaded");
  } catch {
    setStatus(handle, "dynamicSurfaceWater", "error");
  }
}

export function removeDynamicSurfaceWater(map: maplibregl.Map): void {
  try {
    map.removeLayer("dynamic-surface-water-raster");
  } catch {}
  try {
    map.removeSource("dynamic-surface-water");
  } catch {}
}
