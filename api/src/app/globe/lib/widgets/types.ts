/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LayerState, DashboardState, DataStatus } from "../types";
import type { ToolMode } from "../tools/tools";

export interface WidgetPosition {
  x: number;
  y: number;
}

export interface WidgetConfig {
  id: string;
  title: string;
  icon?: string;
  defaultPosition: WidgetPosition;
  defaultCollapsed?: boolean;
  minWidth?: number;
}

export interface WidgetState {
  position: WidgetPosition;
  collapsed: boolean;
  visible: boolean;
  zIndex: number;
}

export interface GlobeContext {
  viewerRef: React.RefObject<any>;
  cesiumRef: React.RefObject<any>;
  state: DashboardState;
  setState: React.Dispatch<React.SetStateAction<DashboardState>>;
  toggleLayer: (key: keyof LayerState) => void;
  switchBasemap: (key: string) => void;
  switchTheme: (key: string) => void;
  switchViewMode: (mode: "3d" | "2d" | "columbus") => void;
  activeTool: ToolMode;
  setActiveTool: React.Dispatch<React.SetStateAction<ToolMode>>;
  toolManagerRef: React.RefObject<any>;
  elevationProfileRef: React.RefObject<any>;
  cursorPos: [number, number] | null;
  dataStatus: DataStatus[];
  flyTo: (lat: number, lon: number, alt?: number) => void;
}

export interface WidgetProps {
  globe: GlobeContext;
}
