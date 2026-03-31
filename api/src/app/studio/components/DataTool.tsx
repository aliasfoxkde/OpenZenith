"use client";

import { useState, useCallback, useRef } from "react";
import type { UploadedDataset, DatasetVisualization, VisualizationMode, ColorRamp } from "../lib/types";
import { SUPPORTED_FORMATS } from "../lib/constants";
import { parseFile, createDataset } from "../lib/parsers";

interface Props {
  dark: boolean;
  datasets: UploadedDataset[];
  onDatasetsChange: (datasets: UploadedDataset[]) => void;
  onToggleDataset: (id: string, visible: boolean) => void;
  onRemoveDataset: (id: string) => void;
  onVisualizationChange?: (id: string, visualization: DatasetVisualization) => void;
}

/** Extract property names from a feature collection */
function getPropertyNames(data: GeoJSON.FeatureCollection): string[] {
  const names = new Set<string>();
  for (const f of data.features) {
    if (!f.properties) continue;
    for (const key of Object.keys(f.properties)) {
      if (key === "name" || key === "description" || key === "type") continue;
      names.add(key);
    }
  }
  return Array.from(names).sort();
}

/** Detect primary geometry type */
function getPrimaryGeometryType(data: GeoJSON.FeatureCollection): "point" | "line" | "polygon" | "mixed" {
  const types = new Set<string>();
  for (const f of data.features) {
    if (f.geometry) types.add(f.geometry.type);
  }
  if (types.size === 0) return "mixed";
  const hasPoint = types.has("Point") || types.has("MultiPoint");
  const hasLine = types.has("LineString") || types.has("MultiLineString");
  const hasPoly = types.has("Polygon") || types.has("MultiPolygon");
  if (types.size === 1) {
    if (hasPoint) return "point";
    if (hasLine) return "line";
    if (hasPoly) return "polygon";
  }
  return "mixed";
}

const MODE_LABELS: Record<VisualizationMode, string> = {
  simple: "Solid",
  choropleth: "By Property",
  heatmap: "Heatmap",
};

const RAMP_LABELS: Record<ColorRamp, string> = {
  sequential: "Sequential",
  diverging: "Diverging",
  categorical: "Categorical",
};

export function DataTool({ dark, datasets, onDatasetsChange, onToggleDataset, onRemoveDataset, onVisualizationChange }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      setError(null);
      const newDatasets: UploadedDataset[] = [];

      Array.from(files).forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            setParsing(true);
            const text = reader.result as string;
            const { data, format } = parseFile(text, file.name);
            const ds = createDataset(data, file.name, format);
            newDatasets.push(ds);
            onDatasetsChange([...datasets, ...newDatasets]);
          } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to parse ${file.name}`);
          } finally {
            setParsing(false);
          }
        };
        reader.readAsText(file);
      });
    },
    [datasets, onDatasetsChange],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const onDragLeave = () => setDragOver(false);

  const handleVizChange = useCallback(
    (ds: UploadedDataset, partial: Partial<DatasetVisualization>) => {
      if (!onVisualizationChange) return;
      const viz: DatasetVisualization = { ...ds.visualization, ...partial };
      onVisualizationChange(ds.id, viz);
    },
    [onVisualizationChange],
  );

  const bg = dark ? "#141414" : "#fff";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#737373";
  const inputBg = dark ? "#1a1a1a" : "#f5f5f5";

  const selectStyle: React.CSSProperties = {
    background: inputBg,
    border: `1px solid ${border}`,
    borderRadius: 3,
    color: text,
    fontSize: 10,
    padding: "3px 4px",
    cursor: "pointer",
    width: "100%",
  };

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
      <div style={{ color: textSec, fontSize: 11 }}>
        Drag & drop files to visualize on the map. Supported: GeoJSON, CSV, GPX, KML.
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#3b82f6" : border}`,
          borderRadius: 8,
          padding: "24px 16px",
          textAlign: "center",
          cursor: "pointer",
          background: dragOver ? (dark ? "#1a2a3a" : "#eff6ff") : inputBg,
          transition: "all 0.2s",
        }}
      >
        <div style={{ fontSize: 20, marginBottom: 4 }}>{dragOver ? "+" : "..."}</div>
        <div style={{ color: text, fontSize: 12, fontWeight: 600 }}>
          {dragOver ? "Drop files here" : "Drop files or click to upload"}
        </div>
        <div style={{ color: textSec, fontSize: 10, marginTop: 4 }}>
          {SUPPORTED_FORMATS.map((f) => f.ext).join(", ")}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={SUPPORTED_FORMATS.map((f) => f.ext).join(",")}
          style={{ display: "none" }}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {parsing && <span style={{ color: textSec, fontSize: 11 }}>Parsing...</span>}
      {error && <div style={{ color: "#ef4444", fontSize: 11 }}>{error}</div>}

      {/* Dataset list */}
      {datasets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ color: textSec, fontSize: 11, fontWeight: 600 }}>
            Datasets ({datasets.length})
          </span>
          {datasets.map((ds) => {
            const geomType = getPrimaryGeometryType(ds.data);
            const props = getPropertyNames(ds.data);
            const isExpanded = expandedId === ds.id;
            const isPointData = geomType === "point" || geomType === "mixed";
            const viz = ds.visualization;

            return (
              <div key={ds.id}>
                {/* Dataset row */}
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                    background: inputBg, border: `1px solid ${border}`, borderRadius: 4,
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: ds.color, flexShrink: 0 }} />
                  <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", flex: 1, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={ds.visible}
                      onChange={(e) => onToggleDataset(ds.id, e.target.checked)}
                    />
                    <span style={{ color: text, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ds.name}>
                      {ds.name}
                    </span>
                  </label>
                  <span style={{ color: textSec, fontSize: 10, flexShrink: 0 }}>
                    {ds.format} &middot; {ds.featureCount}
                  </span>
                  {props.length > 0 && onVisualizationChange && (
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : ds.id)}
                      style={{
                        background: "none", border: "none", color: viz.mode !== "simple" ? "#3b82f6" : textSec,
                        cursor: "pointer", fontSize: 10, padding: "0 2px", lineHeight: 1,
                      }}
                      title="Style options"
                    >
                      {isExpanded ? "\u25B2" : "\u25BC"}
                    </button>
                  )}
                  <button
                    onClick={() => onRemoveDataset(ds.id)}
                    style={{ background: "none", border: "none", color: textSec, cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>

                {/* Visualization options */}
                {isExpanded && props.length > 0 && onVisualizationChange && (
                  <div style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    padding: "8px 10px", marginLeft: 18,
                    borderLeft: `2px solid ${border}`,
                  }}>
                    {/* Style mode */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: textSec, fontSize: 10, width: 48, flexShrink: 0 }}>Style</span>
                      <div style={{ display: "flex", gap: 2 }}>
                        {(Object.entries(MODE_LABELS) as [VisualizationMode, string][])
                          .filter(([mode]) => mode !== "heatmap" || isPointData)
                          .map(([mode, label]) => (
                            <button
                              key={mode}
                              onClick={() => handleVizChange(ds, { mode })}
                              style={{
                                padding: "2px 8px", fontSize: 10,
                                background: viz.mode === mode ? "#3b82f6" : inputBg,
                                border: `1px solid ${viz.mode === mode ? "#3b82f6" : border}`,
                                borderRadius: 3, color: viz.mode === mode ? "#fff" : text,
                                cursor: "pointer",
                              }}
                            >
                              {label}
                            </button>
                          ))}
                      </div>
                    </div>

                    {/* Property selector (for choropleth/heatmap) */}
                    {viz.mode !== "simple" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: textSec, fontSize: 10, width: 48, flexShrink: 0 }}>Property</span>
                        <select
                          value={viz.property ?? ""}
                          onChange={(e) => handleVizChange(ds, { property: e.target.value || null })}
                          style={selectStyle}
                        >
                          <option value="">-- select --</option>
                          {props.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Color ramp (for choropleth) */}
                    {viz.mode === "choropleth" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: textSec, fontSize: 10, width: 48, flexShrink: 0 }}>Ramp</span>
                        <div style={{ display: "flex", gap: 2 }}>
                          {(Object.entries(RAMP_LABELS) as [ColorRamp, string][]).map(([ramp, label]) => (
                            <button
                              key={ramp}
                              onClick={() => handleVizChange(ds, { colorRamp: ramp })}
                              style={{
                                padding: "2px 8px", fontSize: 10,
                                background: viz.colorRamp === ramp ? "#3b82f6" : inputBg,
                                border: `1px solid ${viz.colorRamp === ramp ? "#3b82f6" : border}`,
                                borderRadius: 3, color: viz.colorRamp === ramp ? "#fff" : text,
                                cursor: "pointer",
                              }}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CSV format hint */}
      <div style={{ color: textSec, fontSize: 10, lineHeight: 1.4, padding: "8px 10px", background: inputBg, borderRadius: 4, border: `1px solid ${border}` }}>
        <strong style={{ color: text }}>CSV:</strong> Must have <code style={{ fontFamily: "monospace" }}>lat</code> and <code style={{ fontFamily: "monospace" }}>lon</code> columns. Other columns become point properties.
      </div>
    </div>
  );
}
