/**
 * Elevation-profile overlay lifecycle on the studio map: the dashed
 * endpoint line plus one circle marker per endpoint. Markers are not
 * capped at two — ElevationTool always passes exactly two endpoints today,
 * but the renderer accepts any count, so cleanup enumerates the map's
 * live style layers instead of a hard-coded id list.
 *
 * Every removal is existence-checked first: MapLibre v5 logs a console
 * ErrorEvent for "cannot remove non-existing layer" even when the call
 * sits in a try/catch, and those log lines count as defects.
 */

/** Ids of the layers this module owns (line + one marker per endpoint). */
function profileLayerIds(map: maplibregl.Map): string[] {
  const ids = ["profile-line"];
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.id.startsWith("profile-marker-")) ids.push(layer.id);
  }
  return ids;
}

/** Remove a layer and its source if present. */
function removeIfPresent(map: maplibregl.Map, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

/** Remove every profile layer/source currently on the map (line + N markers). */
export function removeProfileLayers(map: maplibregl.Map): void {
  for (const id of profileLayerIds(map)) removeIfPresent(map, id);
}

/**
 * Draw the profile line and an endpoint marker per coordinate. Existing
 * line/marker sources are updated in place rather than re-added, so a
 * repeated call with the same point count does not stack duplicate
 * layers; markers beyond the new point count are removed.
 */
export function addProfileLayers(map: maplibregl.Map, coords: [number, number][]): void {
  const lineData = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: {},
  };
  const existingLine = map.getSource("profile-line");
  if (existingLine) {
    existingLine.setData(lineData);
  } else {
    map.addSource("profile-line", { type: "geojson", data: lineData });
    map.addLayer({
      id: "profile-line",
      type: "line",
      source: "profile-line",
      paint: {
        "line-color": "#3b82f6",
        "line-width": 3,
        "line-dasharray": [2, 2],
      },
    });
  }

  for (let i = 0; i < coords.length; i++) {
    const markerId = `profile-marker-${i}`;
    if (map.getSource(markerId)) continue;
    map.addSource(markerId, {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: { type: "Point", coordinates: coords[i] },
        properties: {},
      },
    });
    map.addLayer({
      id: markerId,
      type: "circle",
      source: markerId,
      paint: {
        "circle-radius": 6,
        "circle-color": i === 0 ? "#22c55e" : "#ef4444",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fff",
      },
    });
  }

  // A shorter profile must not leave the previous run's extra markers behind.
  for (const id of profileLayerIds(map)) {
    if (!id.startsWith("profile-marker-")) continue;
    const index = Number(id.slice("profile-marker-".length));
    if (Number.isFinite(index) && index >= coords.length) removeIfPresent(map, id);
  }
}
