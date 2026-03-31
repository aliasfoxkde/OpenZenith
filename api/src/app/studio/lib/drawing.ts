/**
 * Drawing tool controller for the Studio map.
 *
 * Supports point, line, and polygon drawing with vertex editing,
 * undo/redo, and GeoJSON export.
 */

export type DrawMode = "none" | "point" | "line" | "polygon";

export interface DrawState {
  mode: DrawMode;
  features: GeoJSON.Feature[];
  currentCoords: [number, number][];
  selectedFeatureIndex: number;
  history: GeoJSON.Feature[][]; // for undo
  redoStack: GeoJSON.Feature[][];
}

export function createDrawState(): DrawState {
  return {
    mode: "none",
    features: [],
    currentCoords: [],
    selectedFeatureIndex: -1,
    history: [],
    redoStack: [],
  };
}

let drawSourceId = "draw-source";
let drawVertexLayerId = "draw-vertices";
let drawLineLayerId = "draw-line";
let drawFillLayerId = "draw-fill";
let drawSelectedLayerId = "draw-selected";

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
}

export function removeDrawLayers(map: any) {
  try { map.removeLayer(drawSelectedLayerId); } catch {}
  try { map.removeLayer(drawFillLayerId); } catch {}
  try { map.removeLayer(drawLineLayerId); } catch {}
  try { map.removeLayer(drawVertexLayerId); } catch {}
  try { map.removeSource(drawSourceId); } catch {}
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
      // Add vertices
      for (const c of state.currentCoords) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: c },
          properties: { vertex: true },
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
    } else {
      // Single point being placed
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
    history: [...state.history, state.features],
    redoStack: [],
  };
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
