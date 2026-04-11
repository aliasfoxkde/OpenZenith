"use client";

import { BASEMAPS } from "../lib/constants";
import type { UploadedDataset } from "../lib/types";

interface Props {
  dark: boolean;
  basemap: string;
  onBasemapChange: (key: string) => void;
  layers: Record<string, boolean>;
  onToggleLayer: (id: string, enabled: boolean) => void;
  datasets: UploadedDataset[];
}

// Layers available in 2D from the shared registry
const DATA_LAYERS = [
  { id: "earthquakes", label: "Earthquakes", category: "Seismic", accent: "#ef4444" },
  { id: "warnings", label: "Weather Warnings", category: "Weather", accent: "#f97316" },
  { id: "waterways", label: "Waterways", category: "Geographic", accent: "#06b6d4" },
  { id: "nlnog", label: "NLNOG Nodes", category: "Network", accent: "#22c55e" },
  { id: "radar", label: "Weather Radar", category: "Weather", accent: "#8b5cf6" },
  { id: "buildings", label: "Building Footprints", category: "Infrastructure", accent: "#d4c5a9" },
  { id: "wildfires", label: "Wildfires", category: "Disasters", accent: "#ff6600" },
];

export function LayersTool({ dark, basemap, onBasemapChange, layers, onToggleLayer, datasets }: Props) {
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#888" : "#737373";
  const inputBg = dark ? "#1a1a1a" : "#f5f5f5";

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
      {/* Basemap selector */}
      <div>
        <div style={{ color: textSec, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Basemap</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {Object.entries(BASEMAPS).map(([key, bm]) => (
            <button
              key={key}
              onClick={() => onBasemapChange(key)}
              style={{
                padding: "6px 8px",
                background: basemap === key ? "#3b82f6" : inputBg,
                border: `1px solid ${basemap === key ? "#3b82f6" : border}`,
                borderRadius: 4,
                color: basemap === key ? "#fff" : text,
                cursor: "pointer",
                fontSize: 11,
                textAlign: "left",
              }}
            >
              {bm.label}
            </button>
          ))}
        </div>
      </div>

      {/* Terrain */}
      <div>
        <div style={{ color: textSec, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Terrain</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!layers.hillshade}
            onChange={(e) => onToggleLayer("hillshade", e.target.checked)}
          />
          <span style={{ color: text, fontSize: 12 }}>Hillshade</span>
        </label>
      </div>

      {/* Data layers */}
      <div>
        <div style={{ color: textSec, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Data Layers</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {DATA_LAYERS.map((layer) => (
            <label
              key={layer.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                padding: "5px 8px",
                background: inputBg,
                border: `1px solid ${border}`,
                borderRadius: 4,
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: 2, background: layer.accent }} />
              <span style={{ color: text, fontSize: 12, flex: 1 }}>{layer.label}</span>
              <input
                type="checkbox"
                checked={!!layers[layer.id]}
                onChange={(e) => onToggleLayer(layer.id, e.target.checked)}
              />
            </label>
          ))}
        </div>
      </div>

      {/* Custom data layers */}
      {datasets.length > 0 && (
        <div>
          <div style={{ color: textSec, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Uploaded Data</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {datasets.map((ds) => (
              <div
                key={ds.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  background: inputBg,
                  border: `1px solid ${border}`,
                  borderRadius: 4,
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: 2, background: ds.color }} />
                <span
                  style={{
                    color: text,
                    fontSize: 11,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ds.name}
                </span>
                <span style={{ color: textSec, fontSize: 10 }}>{ds.featureCount}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
