import type { LayerHandle } from "./types";

/* ─── Equator Reference Line ─── */

export function addEquator(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("equator")) return;

  map.addSource("equator", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [-180, 0],
          [180, 0],
        ],
      },
      properties: {},
    },
  });

  map.addLayer({
    id: "equator-line",
    type: "line",
    source: "equator",
    paint: {
      "line-color": "rgba(255, 255, 255, 0.3)",
      "line-width": 1,
      "line-dasharray": [2, 2],
    },
  });
}

export function removeEquator(map: maplibregl.Map): void {
  try {
    map.removeLayer("equator-line");
  } catch {}
  try {
    map.removeSource("equator");
  } catch {}
}
