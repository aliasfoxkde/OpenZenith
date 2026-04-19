import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Sentinel-2 Imagery ─── */

export function addSentinel2(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("sentinel2")) return;

  map.addSource("sentinel2", {
    type: "raster",
    tiles: ["/api/sentinel2/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 3,
    maxzoom: 14,
  });

  map.addLayer({
    id: "sentinel2-layer",
    type: "raster",
    source: "sentinel2",
    paint: {
      "raster-opacity": 0.8,
      "raster-saturation": 0.3,
    },
  });
}

export function removeSentinel2(map: maplibregl.Map): void {
  try {
    map.removeLayer("sentinel2-layer");
  } catch {}
  try {
    map.removeSource("sentinel2");
  } catch {}
}
