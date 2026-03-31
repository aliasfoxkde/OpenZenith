"use client";

import type { ToolTab } from "../lib/types";
import { ElevationTool } from "./ElevationTool";
import { GeocodeTool } from "./GeocodeTool";
import { OverpassTool } from "./OverpassTool";
import { WeatherTool } from "./WeatherTool";
import { DataTool } from "./DataTool";
import { LayersTool } from "./LayersTool";
import { DrawingTool } from "./DrawingTool";
import type { UploadedDataset, DatasetVisualization } from "../lib/types";

interface Props {
  activeTab: ToolTab;
  onTabChange: (tab: ToolTab) => void;
  dark: boolean;
  map: any;
  cursorPos: { lat: number; lon: number } | null;
  layers: Record<string, boolean> | { hillshade: boolean; boundaries: boolean; earthquakes: boolean; warnings: boolean; waterways: boolean; nlnog: boolean; radar: boolean; weather_warnings: boolean };
  onToggleLayer: (id: string, enabled: boolean) => void;
  basemap: string;
  onBasemapChange: (key: string) => void;
  datasets: UploadedDataset[];
  onDatasetsChange: (datasets: UploadedDataset[]) => void;
  onToggleDataset: (id: string, visible: boolean) => void;
  onRemoveDataset: (id: string) => void;
  onOverpassResult: (data: GeoJSON.FeatureCollection, name: string) => void;
  onVisualizationChange?: (id: string, visualization: DatasetVisualization) => void;
  drawState?: import("../lib/types").DrawState;
  onDrawStateChange?: (state: import("../lib/types").DrawState) => void;
  imperial?: boolean;
  onImperialChange?: (imperial: boolean) => void;
}

const TABS: { id: ToolTab; label: string; icon: string }[] = [
  { id: "elevation", label: "Elevation", icon: "\u26f0" },
  { id: "geocode", label: "Geocode", icon: "\ud83d\udccd" },
  { id: "overpass", label: "OSM Query", icon: "\ud83d\uddfa" },
  { id: "weather", label: "Weather", icon: "\u26c8" },
  { id: "data", label: "Data", icon: "\ud83d\udcc1" },
  { id: "layers", label: "Layers", icon: "\ud83d\udcda" },
  { id: "draw", label: "Draw", icon: "\u270f" },
];

export function ToolPanel(props: Props) {
  const { activeTab, onTabChange, dark } = props;

  const bg = dark ? "#0f0f0f" : "#fafafa";
  const border = dark ? "#2a2a2a" : "#e5e5e5";
  const text = dark ? "#e5e5e5" : "#171717";
  const textSec = dark ? "#666" : "#999";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: bg }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex", borderBottom: `1px solid ${border}`, flexShrink: 0,
          overflowX: "auto", scrollbarWidth: "none",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              padding: "10px 12px",
              background: activeTab === tab.id ? (dark ? "#1a1a1a" : "#fff") : "transparent",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #3b82f6" : "2px solid transparent",
              color: activeTab === tab.id ? text : textSec,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: activeTab === tab.id ? 600 : 400,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {activeTab === "elevation" && (
          <ElevationTool map={props.map} dark={dark} cursorPos={props.cursorPos} />
        )}
        {activeTab === "geocode" && (
          <GeocodeTool map={props.map} dark={dark} />
        )}
        {activeTab === "overpass" && (
          <OverpassTool map={props.map} dark={dark} onResult={props.onOverpassResult} />
        )}
        {activeTab === "weather" && (
          <WeatherTool dark={dark} onToggleLayer={props.onToggleLayer} layers={props.layers} />
        )}
        {activeTab === "data" && (
          <DataTool
            dark={dark}
            datasets={props.datasets}
            onDatasetsChange={props.onDatasetsChange}
            onToggleDataset={props.onToggleDataset}
            onRemoveDataset={props.onRemoveDataset}
            onVisualizationChange={props.onVisualizationChange}
          />
        )}
        {activeTab === "layers" && (
          <LayersTool
            dark={dark}
            basemap={props.basemap}
            onBasemapChange={props.onBasemapChange}
            layers={props.layers}
            onToggleLayer={props.onToggleLayer}
            datasets={props.datasets}
          />
        )}
        {activeTab === "draw" && props.drawState && props.onDrawStateChange && (
          <DrawingTool
            dark={dark}
            drawState={props.drawState}
            onDrawStateChange={props.onDrawStateChange}
            imperial={props.imperial}
            onImperialChange={props.onImperialChange}
          />
        )}
      </div>
    </div>
  );
}
