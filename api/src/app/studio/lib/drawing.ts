/**
 * Drawing tool controller for the Studio map.
 *
 * Supports point, line, and polygon drawing with vertex editing,
 * undo/redo, and GeoJSON export.
 */

import { formatDistance, formatArea } from "@/lib/format-units";

export { formatDistance, formatArea };

export type DrawMode = "none" | "point" | "line" | "polygon" | "edit";

export interface DrawState {
  mode: DrawMode;
  features: GeoJSON.Feature[];
  currentCoords: [number, number][];
  selectedFeatureIndex: number;
  selectedVertexIndex: number; // for vertex editing (-1 = none)
  history: GeoJSON.Feature[][]; // for undo
  redoStack: GeoJSON.Feature[][];
}

export function createDrawState(): DrawState {
  return {
    mode: "none",
    features: [],
    currentCoords: [],
    selectedFeatureIndex: -1,
    selectedVertexIndex: -1,
    history: [],
    redoStack: [],
  };
}

const drawSourceId = "draw-source";
const drawVertexLayerId = "draw-vertices";
const drawSelectedVertexLayerId = "draw-selected-vertex";
const drawLineLayerId = "draw-line";
const drawFillLayerId = "draw-fill";
const drawSelectedLayerId = "draw-selected";
const drawLabelLayerId = "draw-label";

export function addDrawLayers(map: any) {
  if (map.getSource(drawSourceId)) return;

  map.addSource(drawSourceId, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: drawFillLayerId,
    type: "fill",
    source: drawSourceId,
    paint: { "fill-color": "#00e5ff", "fill-opacity": 0.15 },
    filter: ["==", ["geometry-type"], "Polygon"],
  });

  map.addLayer({
    id: drawLineLayerId,
    type: "line",
    source: drawSourceId,
    paint: {
      "line-color": "#00e5ff",
      "line-width": 2,
      "line-dasharray": [2, 2],
    },
  });

  map.addLayer({
    id: drawVertexLayerId,
    type: "circle",
    source: drawSourceId,
    paint: {
      "circle-radius": 5,
      "circle-color": "#fff",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#00e5ff",
    },
    filter: ["==", ["get", "vertex"], true],
  });

  map.addLayer({
    id: drawSelectedVertexLayerId,
    type: "circle",
    source: drawSourceId,
    paint: {
      "circle-radius": 7,
      "circle-color": "#fbbf24",
      "circle-stroke-width": 3,
      "circle-stroke-color": "#fff",
    },
    filter: ["==", ["get", "selectedVertex"], true],
  });

  map.addLayer({
    id: drawSelectedLayerId,
    type: "line",
    source: drawSourceId,
    paint: {
      "line-color": "#fbbf24",
      "line-width": 3,
    },
    filter: ["==", ["get", "selected"], true],
  });

  map.addLayer({
    id: drawLabelLayerId,
    type: "symbol",
    source: drawSourceId,
    layout: {
      "text-field": ["get", "measurement"],
      "text-size": 12,
      "text-anchor": "center",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#00e5ff",
      "text-halo-color": "#000",
      "text-halo-width": 1.5,
    },
    filter: ["has", "measurement"],
  });
}

export function removeDrawLayers(map: any) {
  try {
    map.removeLayer(drawLabelLayerId);
  } catch {}
  try {
    map.removeLayer(drawSelectedLayerId);
  } catch {}
  try {
    map.removeLayer(drawSelectedVertexLayerId);
  } catch {}
  try {
    map.removeLayer(drawFillLayerId);
  } catch {}
  try {
    map.removeLayer(drawLineLayerId);
  } catch {}
  try {
    map.removeLayer(drawVertexLayerId);
  } catch {}
  try {
    map.removeSource(drawSourceId);
  } catch {}
}

export function updateDrawLayers(map: any, state: DrawState) {
  if (!map.getSource(drawSourceId)) return;

  const features: GeoJSON.Feature[] = [];

  // Committed features
  for (let i = 0; i < state.features.length; i++) {
    features.push({
      ...state.features[i],
      properties: { ...state.features[i].properties, selected: i === state.selectedFeatureIndex },
    });

    // Show vertices on selected feature when in edit mode
    if (i === state.selectedFeatureIndex && state.mode === "edit") {
      const coords = getFeatureCoords(state.features[i]);
      if (coords) {
        for (let vi = 0; vi < coords.length; vi++) {
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: coords[vi] },
            properties: {
              vertex: true,
              vertexIndex: vi,
              selectedVertex: vi === state.selectedVertexIndex,
            },
          });
        }
      }
    }
  }

  // Current in-progress drawing
  if (state.currentCoords.length > 0) {
    if (state.mode === "point") {
      for (const c of state.currentCoords) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: c },
          properties: { drawing: true },
        });
      }
    } else if (state.mode === "line" && state.currentCoords.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [...state.currentCoords] },
        properties: { drawing: true },
      });
      for (const c of state.currentCoords) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: c },
          properties: { vertex: true },
        });
      }
      // Measurement label at midpoint
      const m = measureDrawing(state.currentCoords, "line");
      if (m) {
        const mid = Math.floor(state.currentCoords.length / 2);
        const p = state.currentCoords[mid];
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: p },
          properties: { measurement: formatDistance(m.value) },
        });
      }
    } else if (state.mode === "polygon" && state.currentCoords.length >= 3) {
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...state.currentCoords, state.currentCoords[0]]] },
        properties: { drawing: true },
      });
      for (const c of state.currentCoords) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: c },
          properties: { vertex: true },
        });
      }
      // Measurement label at centroid
      const m = measureDrawing(state.currentCoords, "polygon");
      if (m) {
        const cx = state.currentCoords.reduce((s, c) => s + c[0], 0) / state.currentCoords.length;
        const cy = state.currentCoords.reduce((s, c) => s + c[1], 0) / state.currentCoords.length;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [cx, cy] },
          properties: { measurement: formatArea(m.value) },
        });
      }
    } else {
      for (const c of state.currentCoords) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: c },
          properties: { vertex: true },
        });
      }
    }
  }

  (map.getSource(drawSourceId) as any).setData({
    type: "FeatureCollection",
    features,
  });
}

/** Finish current drawing and commit to features array */
export function finishDrawing(state: DrawState): DrawState {
  if (state.currentCoords.length === 0) return state;

  const newFeatures = [...state.features];

  if (state.mode === "point") {
    for (const c of state.currentCoords) {
      newFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: c },
        properties: {},
      });
    }
  } else if (state.mode === "line" && state.currentCoords.length >= 2) {
    newFeatures.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [...state.currentCoords] },
      properties: {},
    });
  } else if (state.mode === "polygon" && state.currentCoords.length >= 3) {
    newFeatures.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...state.currentCoords, state.currentCoords[0]]] },
      properties: {},
    });
  }

  return {
    ...state,
    features: newFeatures,
    currentCoords: [],
    history: [...state.history, state.features],
    redoStack: [],
  };
}

/** Undo last committed feature */
export function undo(state: DrawState): DrawState {
  if (state.history.length === 0) return state;
  const prev = state.history[state.history.length - 1];
  return {
    ...state,
    features: prev,
    history: state.history.slice(0, -1),
    redoStack: [...state.redoStack, state.features],
  };
}

/** Redo last undone feature */
export function redo(state: DrawState): DrawState {
  if (state.redoStack.length === 0) return state;
  const next = state.redoStack[state.redoStack.length - 1];
  return {
    ...state,
    features: next,
    history: [...state.history, state.features],
    redoStack: state.redoStack.slice(0, -1),
  };
}

/** Delete selected feature */
export function deleteSelected(state: DrawState): DrawState {
  if (state.selectedFeatureIndex < 0) return state;
  const newFeatures = state.features.filter((_, i) => i !== state.selectedFeatureIndex);
  return {
    ...state,
    features: newFeatures,
    selectedFeatureIndex: -1,
    selectedVertexIndex: -1,
    history: [...state.history, state.features],
    redoStack: [],
  };
}

/** Get coordinates array from a feature (for vertex editing) */
function getFeatureCoords(feature: GeoJSON.Feature): [number, number][] | null {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === "LineString") return g.coordinates as [number, number][];
  if (g.type === "Polygon") {
    // Edit the outer ring (exclude closing duplicate)
    const ring = g.coordinates[0] as [number, number][];
    return ring.slice(0, -1); // remove closing vertex
  }
  return null;
}

/** Set coordinates back on a feature */
function setFeatureCoords(feature: GeoJSON.Feature, coords: [number, number][]): GeoJSON.Feature {
  const g = feature.geometry!;
  if (g.type === "LineString") {
    return { ...feature, geometry: { type: "LineString", coordinates: [...coords] } };
  }
  if (g.type === "Polygon") {
    return { ...feature, geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] } };
  }
  return feature;
}

/** Move a vertex on the selected feature */
export function moveVertex(state: DrawState, vertexIndex: number, newCoord: [number, number]): DrawState {
  const fi = state.selectedFeatureIndex;
  if (fi < 0 || vertexIndex < 0) return state;
  const feature = state.features[fi];
  const coords = getFeatureCoords(feature);
  if (!coords || vertexIndex >= coords.length) return state;

  const newCoords = [...coords];
  newCoords[vertexIndex] = newCoord;
  const newFeatures = [...state.features];
  newFeatures[fi] = setFeatureCoords(feature, newCoords);

  return {
    ...state,
    features: newFeatures,
    history: [...state.history, state.features],
    redoStack: [],
  };
}

/** Delete a vertex from the selected feature */
export function deleteVertex(state: DrawState, vertexIndex: number): DrawState {
  const fi = state.selectedFeatureIndex;
  if (fi < 0 || vertexIndex < 0) return state;
  const feature = state.features[fi];
  const coords = getFeatureCoords(feature);
  if (!coords || vertexIndex >= coords.length) return state;
  // Don't allow deleting below minimum vertices
  if (coords.length <= (feature.geometry!.type === "LineString" ? 2 : 3)) return state;

  const newCoords = coords.filter((_, i) => i !== vertexIndex);
  const newFeatures = [...state.features];
  newFeatures[fi] = setFeatureCoords(feature, newCoords);

  return {
    ...state,
    features: newFeatures,
    selectedVertexIndex: -1,
    history: [...state.history, state.features],
    redoStack: [],
  };
}

/** Add a vertex after the specified index (or at the end if -1) */
export function addVertex(state: DrawState, afterIndex: number, coord: [number, number]): DrawState {
  const fi = state.selectedFeatureIndex;
  if (fi < 0) return state;
  const feature = state.features[fi];
  const coords = getFeatureCoords(feature);
  if (!coords) return state;

  const newCoords = [...coords];
  if (afterIndex >= 0 && afterIndex < coords.length) {
    newCoords.splice(afterIndex + 1, 0, coord);
  } else {
    newCoords.push(coord);
  }
  const newFeatures = [...state.features];
  newFeatures[fi] = setFeatureCoords(feature, newCoords);

  return {
    ...state,
    features: newFeatures,
    selectedVertexIndex: afterIndex >= 0 ? afterIndex + 1 : newCoords.length - 1,
    history: [...state.history, state.features],
    redoStack: [],
  };
}

/** Enter edit mode for the selected feature */
export function enterEditMode(state: DrawState): DrawState {
  if (state.selectedFeatureIndex < 0) return state;
  const feature = state.features[state.selectedFeatureIndex];
  if (!feature.geometry) return state;
  const editable = feature.geometry.type === "LineString" || feature.geometry.type === "Polygon";
  if (!editable) return state;
  return { ...state, mode: "edit", selectedVertexIndex: -1 };
}

/** Exit edit mode */
export function exitEditMode(state: DrawState): DrawState {
  return { ...state, mode: "none", selectedVertexIndex: -1 };
}

/** Export all features as GeoJSON FeatureCollection */
export function exportGeoJSON(state: DrawState): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: state.features,
  };
}

/** Export all features as GeoJSON string */
export function exportGeoJSONString(state: DrawState): string {
  return JSON.stringify(exportGeoJSON(state), null, 2);
}

/* ─── Measurement ─── */

/** Haversine distance between two [lon, lat] coordinates in meters */
function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la = (a[1] * Math.PI) / 180;
  const lb = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Total length of a polyline in meters */
function lineLength(coords: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
  return d;
}

/** Signed area of a polygon ring in square meters (Shoelace on sphere) */
function ringArea(ring: [number, number][]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let area = 0;
  const R = 6371000;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lat1 = (ring[i][1] * Math.PI) / 180;
    const lat2 = (ring[j][1] * Math.PI) / 180;
    const dLng = ((ring[j][0] - ring[i][0]) * Math.PI) / 180;
    area += dLng * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((area * R * R) / 2);
}

export interface Measurement {
  type: "distance" | "area" | "point";
  value: number; // meters or sq meters
}

/** Measure a GeoJSON feature */
export function measureFeature(feature: GeoJSON.Feature): Measurement | null {
  const g = feature.geometry;
  if (!g) return null;

  if (g.type === "LineString") {
    const d = lineLength(g.coordinates as [number, number][]);
    return { type: "distance", value: d };
  }
  if (g.type === "Polygon") {
    const a = ringArea(g.coordinates[0] as [number, number][]);
    return { type: "area", value: a };
  }
  if (g.type === "Point") {
    return { type: "point", value: 0 };
  }
  return null;
}

/** Measure in-progress drawing (currentCoords) */
export function measureDrawing(coords: [number, number][], mode: DrawMode): Measurement | null {
  if (coords.length === 0) return null;
  if (mode === "line" && coords.length >= 2) {
    return { type: "distance", value: lineLength(coords) };
  }
  if (mode === "polygon" && coords.length >= 3) {
    return { type: "area", value: ringArea([...coords, coords[0]]) };
  }
  if (mode === "point") {
    return { type: "point", value: 0 };
  }
  return null;
}

// formatDistance and formatArea are re-exported from @/lib/format-units at the top of this file
