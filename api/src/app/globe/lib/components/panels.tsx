/**
 * Overlay panels for the globe page: the annotation inline-edit input, the
 * elevation-profile panel, the coordinate-formats panel, and the status bar.
 * Extracted from globe/page.tsx with callback props so the page keeps
 * ownership of viewer state.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { RefObject } from "react";
import { fmtTime } from "../helpers";
import type { DataStatus, LayerState } from "../types";

export interface AnnotationEditState {
  id: string;
  x: number;
  y: number;
}

interface AnnotationEditProps {
  editing: AnnotationEditState;
  viewerRef: RefObject<any>;
  onClose: () => void;
}

/** Inline rename input for a globe annotation label. */
export function AnnotationEdit({ editing, viewerRef, onClose }: AnnotationEditProps) {
  return (
    <div
      className="wv-annotation-edit"
      style={{
        position: "absolute",
        left: editing.x + 16,
        top: editing.y - 10,
        zIndex: 200,
      }}
    >
      <input
        autoFocus
        defaultValue="Double-click to edit"
        className="wv-annotation-input"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const text = (e.target as HTMLInputElement).value.trim();
            const viewer = viewerRef.current;
            if (viewer && text) {
              const entity = viewer.entities.getById(editing.id);
              if (entity?.label) {
                entity.label.text = text;
              }
            }
            onClose();
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        onBlur={(e) => {
          const text = (e.target).value.trim();
          const viewer = viewerRef.current;
          if (viewer && text && text !== "Double-click to edit") {
            const entity = viewer.entities.getById(editing.id);
            if (entity?.label) {
              entity.label.text = text;
            }
          }
          onClose();
        }}
      />
    </div>
  );
}

interface ElevationProfilePanelProps {
  chartRef: RefObject<HTMLDivElement | null>;
  hasData: boolean;
  onClose: () => void;
}

export function ElevationProfilePanel({ chartRef, hasData, onClose }: ElevationProfilePanelProps) {
  return (
    <div className="wv-profile-panel">
      <div className="wv-profile-header">
        <span className="wv-profile-title">Elevation Profile</span>
        <button className="wv-profile-close" aria-label="Close elevation profile" onClick={onClose}>
          &times;
        </button>
      </div>
      <div ref={chartRef} className="wv-profile-chart" />
      {!hasData && <div className="wv-profile-hint">Click 2+ points on the globe to create a terrain cross-section</div>}
    </div>
  );
}

interface CoordinateFormatsPanelProps {
  formats: Record<string, string>;
  onClose: () => void;
}

export function CoordinateFormatsPanel({ formats, onClose }: CoordinateFormatsPanelProps) {
  return (
    <div className="wv-coord-panel">
      <button className="wv-coord-close" aria-label="Close coordinate panel" onClick={onClose} title="Close (C)">
        &times;
      </button>
      {Object.entries(formats).map(([fmt, val]) => (
        <div key={fmt} className="wv-coord-row">
          <span className="wv-coord-label">{fmt}</span>
          <span
            className="wv-coord-val"
            title="Click to copy"
            onClick={() => {
              // Clipboard access is denied in insecure contexts; a copy
              // failure is not worth surfacing as an unhandled rejection.
              navigator.clipboard.writeText(val).catch(() => {});
            }}
          >
            {val}
          </span>
        </div>
      ))}
    </div>
  );
}

interface GlobeStatusBarProps {
  dataStatus: DataStatus[];
  layers: LayerState;
  cursorPos: [number, number] | null;
  isSpaceMode: boolean;
  cameraAlt: number;
}

export function GlobeStatusBar({ dataStatus, layers, cursorPos, isSpaceMode, cameraAlt }: GlobeStatusBarProps) {
  return (
    <div className="wv-status">
      {dataStatus.map((ds) => {
        const isActive = layers[ds.key as keyof LayerState];
        // Only show active layers or layers with errors
        if (!isActive && !ds.error) return null;
        const indicatorClass = ds.error ? "err" : ds.lastUpdate ? "ok" : "loading";
        return (
          <div key={ds.key} className="wv-status-item">
            <span className={`indicator ${indicatorClass}`} />
            <span>{ds.label}</span>
            {ds.error && <span style={{ color: "var(--error, #ff4444)" }}>({ds.error})</span>}
            {isActive && !ds.error && ds.count > 0 && <span style={{ color: "#555" }}>({ds.count})</span>}
            {isActive && !ds.error && ds.lastUpdate && <span style={{ color: "#444" }}>{fmtTime(ds.lastUpdate)}</span>}
          </div>
        );
      })}
      <span className="wv-status-sep" />
      <span className="wv-coords">{cursorPos ? `${cursorPos[0]}, ${cursorPos[1]}` : "--"}</span>
      <span className="wv-status-sep" />
      <span className="wv-coords" style={{ color: isSpaceMode ? "var(--accent)" : "var(--text-muted)" }}>
        {isSpaceMode
          ? `${(cameraAlt / 1000).toFixed(0)} km`
          : cameraAlt > 1000
            ? `${(cameraAlt / 1000).toFixed(1)} km`
            : `${cameraAlt.toFixed(0)} m`}
      </span>
    </div>
  );
}
