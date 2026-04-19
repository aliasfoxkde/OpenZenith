import type { LayerHandle } from "./types";

/* ─── Buildings (Overture Maps) ─── */

export function addBuildings(map: maplibregl.Map, _handle: LayerHandle): void {
  if (map.getSource("overture-buildings")) return;

  map.addSource("overture-buildings", {
    type: "vector",
    tiles: ["https://tiles.overturemaps.org/{z}/{x}/{y}.pbf"],
    maxzoom: 16,
  });

  map.addLayer({
    id: "buildings-fill",
    type: "fill",
    source: "overture-buildings",
    "source-layer": "building",
    minzoom: 12,
    paint: {
      "fill-color": "#d4c5a9",
      "fill-opacity": 0.5,
    },
  });

  map.addLayer({
    id: "buildings-outline",
    type: "line",
    source: "overture-buildings",
    "source-layer": "building",
    minzoom: 12,
    paint: {
      "line-color": "#a89070",
      "line-width": 0.5,
      "line-opacity": 0.7,
    },
  });
}

export function removeBuildings(map: maplibregl.Map): void {
  try {
    map.removeLayer("buildings-outline");
  } catch {}
  try {
    map.removeLayer("buildings-fill");
  } catch {}
  try {
    map.removeSource("overture-buildings");
  } catch {}
}
