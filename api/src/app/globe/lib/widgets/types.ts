import type { LayerState, DashboardState, DataStatus } from "../types";
import type { ToolMode, createToolManager } from "../tools/tools";
import type { createElevationProfile } from "../tools/elevation-profile";

/** Widget top-left corner as an offset from the globe viewport's top-left, in pixels. */
export interface WidgetPosition {
  x: number;
  y: number;
}

/**
 * Static definition of a widget slot. `id` is the registry key and the key its
 * state is stored under in localStorage, `title` the header text, `icon` an
 * optional emoji glyph, `defaultPosition` the initial top-left offset in
 * pixels, `defaultCollapsed` the initial collapsed flag (false when omitted),
 * and `minWidth` a CSS minimum width in pixels.
 */
export interface WidgetConfig {
  id: string;
  title: string;
  icon?: string;
  defaultPosition: WidgetPosition;
  defaultCollapsed?: boolean;
  minWidth?: number;
}

/**
 * Live per-widget UI state, all of it persisted: `position` is the top-left
 * offset in pixels, `collapsed` whether the body is folded, `visible` whether
 * the widget renders at all, and `zIndex` the stacking order (numbering starts
 * just above 100; focusWidget raises the focused widget to max + 1).
 */
export interface WidgetState {
  position: WidgetPosition;
  collapsed: boolean;
  visible: boolean;
  zIndex: number;
}

/**
 * Everything a widget can reach on the globe. `viewerRef` and `cesiumRef` are
 * refs to the live Cesium Viewer and the Cesium module, both null until viewer
 * init finishes. `state`/`setState` expose the dashboard state — center as
 * [longitude, latitude] in degrees, zoom, basemap and theme keys, the
 * LayerState toggle map, and viewMode ("3d" | "2d" | "columbus");
 * `toggleLayer` flips one LayerState key and `switchBasemap`/`switchTheme`/
 * `switchViewMode` switch by key. `activeTool`/`setActiveTool` mirror the armed
 * ToolMode, `toolManagerRef` and `elevationProfileRef` hold the two measurement
 * tool instances created by page.tsx. `cursorPos` is the [lng, lat] under the
 * pointer in degrees or null when off-globe, and `dataStatus` is per-layer
 * freshness (epoch-ms lastUpdate, feature count, error string). `flyTo(lat,
 * lon, alt)` animates the camera over 1.5 s at 45 deg pitch, altitude in
 * metres (default 50 000).
 */
export interface GlobeContext {
  viewerRef: React.RefObject<CesiumType.Viewer | null>;
  cesiumRef: React.RefObject<typeof CesiumType | null>;
  state: DashboardState;
  setState: React.Dispatch<React.SetStateAction<DashboardState>>;
  toggleLayer: (key: keyof LayerState) => void;
  switchBasemap: (key: string) => void;
  switchTheme: (key: string) => void;
  switchViewMode: (mode: "3d" | "2d" | "columbus") => void;
  activeTool: ToolMode;
  setActiveTool: React.Dispatch<React.SetStateAction<ToolMode>>;
  toolManagerRef: React.RefObject<ReturnType<typeof createToolManager> | null>;
  elevationProfileRef: React.RefObject<ReturnType<typeof createElevationProfile> | null>;
  cursorPos: [number, number] | null;
  dataStatus: DataStatus[];
  flyTo: (lat: number, lon: number, alt?: number) => void;
}

/** The single prop every widget component receives: the shared GlobeContext. */
export interface WidgetProps {
  globe: GlobeContext;
}
