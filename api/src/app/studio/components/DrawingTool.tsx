"use client";

import type { DrawMode, DrawState } from "../lib/drawing";
import { createDrawState, finishDrawing, undo, redo, deleteSelected, exportGeoJSONString } from "../lib/drawing";

interface Props {
  dark: boolean;
  drawState: DrawState;
  onDrawStateChange: (state: DrawState) => void;
}

const MODES: { id: DrawMode; label: string; desc: string }[] = [
  { id: "point", label: "Point", desc: "Click to place points" },
  { id: "line", label: "Line", desc: "Click to add vertices, Enter to finish" },
  { id: "polygon", label: "Polygon", desc: "Click to add vertices, Enter to finish" },
];

export function DrawingTool({ dark, drawState, onDrawStateChange }: Props) {
  const bg = dark ? "#0f0f0f" : "#fafafa";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#666" : "#999";

  const handleExport = () => {
    const json = exportGeoJSONString(drawState);
    const blob = new Blob([json], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "drawn-features.geojson";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJSON = () => {
    navigator.clipboard.writeText(exportGeoJSONString(drawState));
  };

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: textSec, marginBottom: 4 }}>
        Draw on the map. Press Escape to cancel, Enter to finish.
      </div>

      {/* Mode selection */}
      <div style={{ display: "flex", gap: 4 }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onDrawStateChange({
              ...createDrawState(),
              mode: drawState.mode === m.id ? "none" : m.id,
            })}
            style={{
              flex: 1,
              padding: "8px 4px",
              background: drawState.mode === m.id ? "#3b82f6" : bg,
              border: `1px solid ${drawState.mode === m.id ? "#3b82f6" : border}`,
              borderRadius: 4,
              color: drawState.mode === m.id ? "#fff" : text,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Active drawing info */}
      {drawState.mode !== "none" && drawState.currentCoords.length > 0 && (
        <div style={{ fontSize: 11, color: "#3b82f6" }}>
          {drawState.currentCoords.length} point{drawState.currentCoords.length > 1 ? "s" : ""} placed
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={() => onDrawStateChange(undo(drawState))}
          disabled={drawState.history.length === 0}
          style={{
            flex: 1,
            padding: "6px",
            background: bg,
            border: `1px solid ${border}`,
            borderRadius: 4,
            color: drawState.history.length === 0 ? textSec : text,
            cursor: drawState.history.length === 0 ? "default" : "pointer",
            fontSize: 11,
          }}
        >
          Undo
        </button>
        <button
          onClick={() => onDrawStateChange(redo(drawState))}
          disabled={drawState.redoStack.length === 0}
          style={{
            flex: 1,
            padding: "6px",
            background: bg,
            border: `1px solid ${border}`,
            borderRadius: 4,
            color: drawState.redoStack.length === 0 ? textSec : text,
            cursor: drawState.redoStack.length === 0 ? "default" : "pointer",
            fontSize: 11,
          }}
        >
          Redo
        </button>
        <button
          onClick={() => onDrawStateChange(deleteSelected(drawState))}
          disabled={drawState.selectedFeatureIndex < 0}
          style={{
            flex: 1,
            padding: "6px",
            background: bg,
            border: `1px solid ${border}`,
            borderRadius: 4,
            color: drawState.selectedFeatureIndex < 0 ? textSec : "#ef4444",
            cursor: drawState.selectedFeatureIndex < 0 ? "default" : "pointer",
            fontSize: 11,
          }}
        >
          Delete
        </button>
        <button
          onClick={() => onDrawStateChange(createDrawState())}
          style={{
            flex: 1,
            padding: "6px",
            background: bg,
            border: `1px solid ${border}`,
            borderRadius: 4,
            color: drawState.features.length === 0 ? textSec : "#ef4444",
            cursor: drawState.features.length === 0 ? "default" : "pointer",
            fontSize: 11,
          }}
        >
          Clear
        </button>
      </div>

      {/* Export */}
      {drawState.features.length > 0 && (
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={handleExport}
            style={{
              flex: 1,
              padding: "6px",
              background: "#3b82f6",
              border: "none",
              borderRadius: 4,
              color: "#fff",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Export GeoJSON
          </button>
          <button
            onClick={handleCopyJSON}
            style={{
              flex: 1,
              padding: "6px",
              background: bg,
              border: `1px solid ${border}`,
              borderRadius: 4,
              color: text,
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Copy JSON
          </button>
        </div>
      )}

      {/* Feature count */}
      <div style={{ fontSize: 11, color: textSec }}>
        {drawState.features.length} feature{drawState.features.length !== 1 ? "s" : ""}
        {drawState.selectedFeatureIndex >= 0 && (
          <span style={{ color: "#fbbf24" }}> (#{drawState.selectedFeatureIndex + 1} selected)</span>
        )}
      </div>
    </div>
  );
}
