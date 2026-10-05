import type { LayerHandle } from "./types";

/* ─── Equator Reference Line ─── */

/**
 * Add a dashed reference line along 0° latitude: an inline GeoJSON
 * LineString from (-180, 0) to (180, 0) rendered as a 1px white 30%-opacity
 * dashed line. Pure client-side geometry — no network, no status on the
 * handle.
 */
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

/** Remove the equator line layer and its `equator` GeoJSON source, ignoring "not found" errors. */
export function removeEquator(map: maplibregl.Map): void {
  try {
    map.removeLayer("equator-line");
  } catch {}
  try {
    map.removeSource("equator");
  } catch {}
}
