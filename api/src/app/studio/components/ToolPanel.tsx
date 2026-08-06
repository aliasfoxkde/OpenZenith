"use client";

import { lazy, Suspense } from "react";
import type { ToolTab } from "../lib/types";
import type { UploadedDataset, DatasetVisualization } from "../lib/types";

const ElevationTool = lazy(() => import("./ElevationTool").then((m) => ({ default: m.ElevationTool })));
const GeocodeTool = lazy(() => import("./GeocodeTool").then((m) => ({ default: m.GeocodeTool })));
const OverpassTool = lazy(() => import("./OverpassTool").then((m) => ({ default: m.OverpassTool })));
const WeatherTool = lazy(() => import("./WeatherTool").then((m) => ({ default: m.WeatherTool })));
const DataTool = lazy(() => import("./DataTool").then((m) => ({ default: m.DataTool })));
const LayersTool = lazy(() => import("./LayersTool").then((m) => ({ default: m.LayersTool })));
const DrawingTool = lazy(() => import("./DrawingTool").then((m) => ({ default: m.DrawingTool })));
const TileDownloadTool = lazy(() => import("./TileDownloadTool").then((m) => ({ default: m.TileDownloadTool })));
const FlowPathTool = lazy(() => import("./FlowPathTool").then((m) => ({ default: m.FlowPathTool })));

interface Props {
  activeTab: ToolTab;
  onTabChange: (tab: ToolTab) => void;
  dark: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map: any;
  cursorPos: { lat: number; lon: number } | null;
  layers: Record<string, boolean>;
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
  onProfileChange?: (coords: [number, number][] | null) => void;
  profileClickRef?: React.MutableRefObject<((lat: number, lon: number) => void) | null>;
  flowPathClickRef?: React.MutableRefObject<((lat: number, lon: number) => void) | null>;
  flowPathActive?: boolean;
}

const TABS: { id: ToolTab; label: string; icon: string }[] = [
  { id: "elevation", label: "Elevation", icon: "\u26f0" },
  { id: "geocode", label: "Geocode", icon: "\ud83d\udccd" },
  { id: "overpass", label: "OSM Query", icon: "\ud83d\uddfa" },
  { id: "weather", label: "Weather", icon: "\u26c8" },
  { id: "data", label: "Data", icon: "\ud83d\udcc1" },
  { id: "layers", label: "Layers", icon: "\ud83d\udcda" },
  { id: "draw", label: "Draw", icon: "\u270f" },
  { id: "tiles", label: "Tiles", icon: "\ud83d\uddfa" },
  { id: "flowpath", label: "Flow Path", icon: "\u21c9" },
];

function ToolFallback({ dark }: { dark: boolean }) {
  return <div style={{ padding: 12, color: dark ? "#666" : "#999", fontSize: 12 }}>Loading...</div>;
}

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
        role="tablist"
        aria-label="Studio tool tabs"
        style={{
          display: "flex",
          borderBottom: `1px solid ${border}`,
          flexShrink: 0,
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
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
          <div role="tabpanel" id="panel-elevation" aria-label="Elevation tool">
            <Suspense fallback={<ToolFallback dark={dark} />}>
              <ElevationTool
                map={props.map}
                dark={dark}
                cursorPos={props.cursorPos}
                onProfileChange={props.onProfileChange}
                profileClickRef={props.profileClickRef}
              />
            </Suspense>
          </div>
        )}
        {activeTab === "geocode" && (
          <div role="tabpanel" id="panel-geocode" aria-label="Geocode tool">
            <Suspense fallback={<ToolFallback dark={dark} />}>
              <GeocodeTool map={props.map} dark={dark} />
            </Suspense>
          </div>
        )}
        {activeTab === "overpass" && (
          <div role="tabpanel" id="panel-overpass" aria-label="OSM query tool">
            <Suspense fallback={<ToolFallback dark={dark} />}>
              <OverpassTool map={props.map} dark={dark} onResult={props.onOverpassResult} />
            </Suspense>
          </div>
        )}
        {activeTab === "weather" && (
          <div role="tabpanel" id="panel-weather" aria-label="Weather tool">
            <Suspense fallback={<ToolFallback dark={dark} />}>
              <WeatherTool dark={dark} onToggleLayer={props.onToggleLayer} layers={props.layers} />
            </Suspense>
          </div>
        )}
        {activeTab === "data" && (
          <div role="tabpanel" id="panel-data" aria-label="Data upload tool">
            <Suspense fallback={<ToolFallback dark={dark} />}>
              <DataTool
                dark={dark}
                datasets={props.datasets}
                onDatasetsChange={props.onDatasetsChange}
                onToggleDataset={props.onToggleDataset}
                onRemoveDataset={props.onRemoveDataset}
                onVisualizationChange={props.onVisualizationChange}
              />
            </Suspense>
          </div>
        )}
        {activeTab === "layers" && (
          <div role="tabpanel" id="panel-layers" aria-label="Layers tool">
            <Suspense fallback={<ToolFallback dark={dark} />}>
              <LayersTool
                dark={dark}
                basemap={props.basemap}
                onBasemapChange={props.onBasemapChange}
                layers={props.layers}
                onToggleLayer={props.onToggleLayer}
                datasets={props.datasets}
              />
            </Suspense>
          </div>
        )}
        {activeTab === "draw" && props.drawState && props.onDrawStateChange && (
          <div role="tabpanel" id="panel-draw" aria-label="Drawing tool">
            <Suspense fallback={<ToolFallback dark={dark} />}>
              <DrawingTool
                dark={dark}
                drawState={props.drawState}
                onDrawStateChange={props.onDrawStateChange}
                imperial={props.imperial}
                onImperialChange={props.onImperialChange}
              />
            </Suspense>
          </div>
        )}
        {activeTab === "tiles" && (
          <div role="tabpanel" id="panel-tiles" aria-label="Tile download tool">
            <Suspense fallback={<ToolFallback dark={dark} />}>
              <TileDownloadTool dark={dark} map={props.map} />
            </Suspense>
          </div>
        )}
        {activeTab === "flowpath" && (
          <div role="tabpanel" id="panel-flowpath" aria-label="Flow path tool">
            <Suspense fallback={<ToolFallback dark={dark} />}>
              <FlowPathTool
                dark={dark}
                map={props.map}
                cursorPos={props.cursorPos}
                imperial={props.imperial}
                flowPathClickRef={props.flowPathClickRef}
              />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
