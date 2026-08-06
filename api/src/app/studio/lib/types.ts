export type ToolTab = "elevation" | "geocode" | "overpass" | "weather" | "data" | "layers" | "draw" | "tiles" | "flowpath";

export interface StudioState {
  activeTab: ToolTab;
  sidebarOpen: boolean;
  dark: boolean;
  cursorPos: { lat: number; lon: number } | null;
  zoom: number;
}

export type ColorRamp = "sequential" | "diverging" | "categorical";

export type VisualizationMode = "simple" | "choropleth" | "heatmap";

export interface DatasetVisualization {
  mode: VisualizationMode;
  property: string | null;
  colorRamp: ColorRamp;
}

export interface UploadedDataset {
  id: string;
  name: string;
  format: string;
  featureCount: number;
  visible: boolean;
  color: string;
  data: GeoJSON.FeatureCollection;
  visualization: DatasetVisualization;
}

export interface ElevationResult {
  lat: number;
  lon: number;
  elevation: number | null;
  surfaceType?: string;
}

export interface GeocodeResult {
  display_name: string;
  lat: number;
  lon: number;
  type: string;
  importance: number;
}

export interface OverpassPreset {
  label: string;
  query: string;
  description: string;
}

export interface MarkerPin {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  elevation?: number | null;
}

export type DrawMode = "none" | "point" | "line" | "polygon" | "edit";

export interface DrawState {
  mode: DrawMode;
  features: GeoJSON.Feature[];
  currentCoords: [number, number][];
  selectedFeatureIndex: number;
  selectedVertexIndex: number;
  history: GeoJSON.Feature[][];
  redoStack: GeoJSON.Feature[][];
}
