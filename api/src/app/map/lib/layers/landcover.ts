import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── CORINE Land Cover ─── */

export function addLandCover(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("land-cover")) return;

  map.addSource("land-cover", {
    type: "raster",
    tiles: ["/api/landcover/{z}/{x}/{y}"],
    tileSize: 256,
    minzoom: 4,
    maxzoom: 13,
  });

  map.addLayer({
    id: "land-cover-layer",
    type: "raster",
    source: "land-cover",
    paint: {
      "raster-opacity": 0.5,
    },
  });
}

export function removeLandCover(map: maplibregl.Map): void {
  try {
    map.removeLayer("land-cover-layer");
  } catch {}
  try {
    map.removeSource("land-cover");
  } catch {}
}
