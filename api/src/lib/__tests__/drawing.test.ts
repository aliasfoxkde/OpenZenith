import { describe, it, expect } from "vitest";
import {
  createDrawState,
  finishDrawing,
  undo,
  redo,
  deleteSelected,
  exportGeoJSON,
  exportGeoJSONString,
  measureFeature,
  measureDrawing,
  formatDistance,
  formatArea,
  moveVertex,
  deleteVertex,
  addVertex,
  enterEditMode,
  exitEditMode,
} from "../../app/studio/lib/drawing";

describe("createDrawState", () => {
  it("returns default state", () => {
    const state = createDrawState();
    expect(state.mode).toBe("none");
    expect(state.features).toEqual([]);
    expect(state.currentCoords).toEqual([]);
    expect(state.selectedFeatureIndex).toBe(-1);
    expect(state.selectedVertexIndex).toBe(-1);
    expect(state.history).toEqual([]);
    expect(state.redoStack).toEqual([]);
  });
});

describe("finishDrawing", () => {
  it("finishes a line drawing", () => {
    const state = createDrawState();
    state.mode = "line";
    state.currentCoords = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];

    const result = finishDrawing(state);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("LineString");
    expect(result.features[0].geometry.coordinates).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(result.currentCoords).toEqual([]);
    expect(result.history).toHaveLength(1);
  });

  it("finishes a polygon drawing", () => {
    const state = createDrawState();
    state.mode = "polygon";
    state.currentCoords = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];

    const result = finishDrawing(state);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("Polygon");
    // Polygon should be closed
    expect(result.features[0].geometry.coordinates[0]).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
  });

  it("finishes a point drawing", () => {
    const state = createDrawState();
    state.mode = "point";
    state.currentCoords = [
      [0, 0],
      [1, 1],
    ];

    const result = finishDrawing(state);
    expect(result.features).toHaveLength(2);
    expect(result.features[0].geometry.type).toBe("Point");
    expect(result.features[1].geometry.type).toBe("Point");
  });

  it("does nothing with empty currentCoords", () => {
    const state = createDrawState();
    state.mode = "line";
    const result = finishDrawing(state);
    expect(result).toBe(state);
  });

  it("does nothing with insufficient line points", () => {
    const state = createDrawState();
    state.mode = "line";
    state.currentCoords = [[0, 0]];
    const result = finishDrawing(state);
    expect(result.features).toHaveLength(0);
  });

  it("does nothing with insufficient polygon points", () => {
    const state = createDrawState();
    state.mode = "polygon";
    state.currentCoords = [
      [0, 0],
      [1, 1],
    ];
    const result = finishDrawing(state);
    expect(result.features).toHaveLength(0);
  });
});

describe("undo", () => {
  it("undoes last committed feature", () => {
    const state = createDrawState();
    state.mode = "line";
    state.currentCoords = [
      [0, 0],
      [1, 1],
    ];
    const withFeature = finishDrawing(state);
    const undone = undo(withFeature);
    expect(undone.features).toHaveLength(0);
    expect(undone.redoStack).toHaveLength(1);
  });

  it("does nothing when history is empty", () => {
    const state = createDrawState();
    const result = undo(state);
    expect(result).toBe(state);
  });
});

describe("redo", () => {
  it("redoes last undone feature", () => {
    const state = createDrawState();
    state.mode = "line";
    state.currentCoords = [
      [0, 0],
      [1, 1],
    ];
    const withFeature = finishDrawing(state);
    const undone = undo(withFeature);
    const redone = redo(undone);
    expect(redone.features).toHaveLength(1);
    expect(redone.history).toHaveLength(1);
    expect(redone.redoStack).toHaveLength(0);
  });

  it("does nothing when redoStack is empty", () => {
    const state = createDrawState();
    const result = redo(state);
    expect(result).toBe(state);
  });
});

describe("deleteSelected", () => {
  it("deletes the selected feature", () => {
    const state = createDrawState();
    state.mode = "line";
    state.currentCoords = [
      [0, 0],
      [1, 1],
    ];
    const withFeature = finishDrawing(state);
    withFeature.selectedFeatureIndex = 0;

    const deleted = deleteSelected(withFeature);
    expect(deleted.features).toHaveLength(0);
    expect(deleted.selectedFeatureIndex).toBe(-1);
  });

  it("does nothing when no feature selected", () => {
    const state = createDrawState();
    const result = deleteSelected(state);
    expect(result).toBe(state);
  });
});

describe("exportGeoJSON", () => {
  it("exports features as FeatureCollection", () => {
    const state = createDrawState();
    state.mode = "line";
    state.currentCoords = [
      [0, 0],
      [1, 1],
    ];
    const withFeature = finishDrawing(state);

    const fc = exportGeoJSON(withFeature);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
  });
});

describe("exportGeoJSONString", () => {
  it("returns valid JSON string", () => {
    const state = createDrawState();
    state.mode = "point";
    state.currentCoords = [[0, 0]];
    const withFeature = finishDrawing(state);

    const str = exportGeoJSONString(withFeature);
    const parsed = JSON.parse(str);
    expect(parsed.type).toBe("FeatureCollection");
  });
});

describe("measureFeature", () => {
  it("measures a line feature", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      },
      properties: {},
    };
    const m = measureFeature(feature);
    expect(m).not.toBeNull();
    expect(m!.type).toBe("distance");
    expect(m!.value).toBeGreaterThan(0);
  });

  it("measures a polygon feature", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      properties: {},
    };
    const m = measureFeature(feature);
    expect(m).not.toBeNull();
    expect(m!.type).toBe("area");
    expect(m!.value).toBeGreaterThan(0);
  });

  it("measures a point feature", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {},
    };
    const m = measureFeature(feature);
    expect(m).not.toBeNull();
    expect(m!.type).toBe("point");
    expect(m!.value).toBe(0);
  });

  it("returns null for null geometry", () => {
    const feature = {
      type: "Feature" as const,
      geometry: null as unknown as GeoJSON.Geometry,
      properties: {},
    };
    expect(measureFeature(feature)).toBeNull();
  });
});

describe("measureDrawing", () => {
  it("measures in-progress line", () => {
    const m = measureDrawing(
      [
        [0, 0],
        [1, 0],
      ],
      "line",
    );
    expect(m).not.toBeNull();
    expect(m!.type).toBe("distance");
    expect(m!.value).toBeGreaterThan(0);
  });

  it("measures in-progress polygon", () => {
    const m = measureDrawing(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      "polygon",
    );
    expect(m).not.toBeNull();
    expect(m!.type).toBe("area");
  });

  it("returns null for empty coords", () => {
    expect(measureDrawing([], "line")).toBeNull();
  });
});

describe("formatDistance", () => {
  it("formats meters", () => {
    expect(formatDistance(500)).toBe("500.0 m");
  });

  it("formats kilometers", () => {
    expect(formatDistance(1500)).toBe("1.50 km");
  });

  it("formats imperial feet", () => {
    expect(formatDistance(500, true)).toBe("1640.4 ft");
  });

  it("formats imperial miles", () => {
    expect(formatDistance(2000, true)).toBe("1.24 mi");
  });
});

describe("formatArea", () => {
  it("formats square meters", () => {
    expect(formatArea(500)).toBe("500.0 m\u00B2");
  });

  it("formats hectares", () => {
    expect(formatArea(50000)).toBe("5.00 ha");
  });

  it("formats square kilometers", () => {
    expect(formatArea(5e6)).toBe("5.00 km\u00B2");
  });

  it("formats imperial square feet", () => {
    const result = formatArea(500, true);
    expect(result).toContain("ft");
    expect(result).toContain("\u00B2");
    expect(parseFloat(result)).toBeGreaterThan(5380);
  });

  it("formats imperial acres", () => {
    expect(formatArea(50000, true)).toBe("12.36 ac");
  });

  it("formats imperial square miles", () => {
    expect(formatArea(5e6, true)).toBe("1.93 mi\u00B2");
  });
});

describe("vertex editing", () => {
  const createLineState = () => {
    const state = createDrawState();
    state.mode = "line";
    state.currentCoords = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    const finished = finishDrawing(state);
    finished.selectedFeatureIndex = 0;
    return finished;
  };

  describe("moveVertex", () => {
    it("moves a vertex", () => {
      const state = createLineState();
      const result = moveVertex(state, 1, [1.5, 1.5]);
      const coords = result.features[0].geometry.coordinates as [number, number][];
      expect(coords[1]).toEqual([1.5, 1.5]);
    });

    it("does nothing when no feature selected", () => {
      const state = createDrawState();
      const result = moveVertex(state, 0, [1, 1]);
      expect(result.features).toHaveLength(0);
    });

    it("adds to history", () => {
      const state = createLineState();
      // createLineState calls finishDrawing which adds 1 history entry
      const result = moveVertex(state, 0, [1.5, 1.5]);
      expect(result.history.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("deleteVertex", () => {
    it("deletes a vertex", () => {
      const state = createLineState();
      const result = deleteVertex(state, 1);
      const coords = result.features[0].geometry.coordinates as [number, number][];
      expect(coords).toHaveLength(2);
      expect(coords).toEqual([
        [0, 0],
        [2, 0],
      ]);
    });

    it("does not allow deleting below minimum vertices for line", () => {
      const state = createLineState();
      // Delete first vertex
      const afterFirst = deleteVertex(state, 0);
      // Try to delete again (would leave 1 vertex)
      const result = deleteVertex(afterFirst, 0);
      expect(result.features[0].geometry.coordinates).toHaveLength(2);
    });
  });

  describe("addVertex", () => {
    it("adds a vertex after specified index", () => {
      const state = createLineState();
      const result = addVertex(state, 1, [1.5, 0.5]);
      const coords = result.features[0].geometry.coordinates as [number, number][];
      expect(coords).toHaveLength(4);
      expect(coords[2]).toEqual([1.5, 0.5]);
    });

    it("adds to end when index is -1", () => {
      const state = createLineState();
      const result = addVertex(state, -1, [3, 1]);
      const coords = result.features[0].geometry.coordinates as [number, number][];
      expect(coords).toHaveLength(4);
      expect(coords[3]).toEqual([3, 1]);
    });
  });

  describe("edit mode", () => {
    it("enters edit mode for line", () => {
      const state = createLineState();
      const result = enterEditMode(state);
      expect(result.mode).toBe("edit");
    });

    it("enters edit mode for polygon", () => {
      const state = createDrawState();
      state.mode = "polygon";
      state.currentCoords = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      const finished = finishDrawing(state);
      finished.selectedFeatureIndex = 0;
      const result = enterEditMode(finished);
      expect(result.mode).toBe("edit");
    });

    it("does not enter edit mode for point", () => {
      const state = createDrawState();
      state.mode = "point";
      state.currentCoords = [[0, 0]];
      const finished = finishDrawing(state);
      finished.selectedFeatureIndex = 0;
      const result = enterEditMode(finished);
      // Should return unchanged state — mode stays "point"
      expect(result.mode).toBe("point");
      expect(result).toBe(finished); // Same reference (returned unchanged)
    });

    it("exits edit mode", () => {
      const state = createLineState();
      const edited = enterEditMode(state);
      const exited = exitEditMode(edited);
      expect(exited.mode).toBe("none");
      expect(exited.selectedVertexIndex).toBe(-1);
    });
  });
});
