export type ToolTab = "elevation" | "geocode" | "overpass" | "weather" | "data" | "layers";

export interface StudioState {
  activeTab: ToolTab;
  sidebarOpen: boolean;
  dark: boolean;
  cursorPos: { lat: number; lon: number } | null;
  zoom: number;
}

export interface UploadedDataset {
  id: string;
  name: string;
  format: string;
  featureCount: number;
  visible: boolean;
  color: string;
  data: GeoJSON.FeatureCollection;
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

export type DrawMode = "none" | "point" | "line" | "polygon" | "measure";

export interface DrawState {
  mode: DrawMode;
  points: Array<{ lat: number; lon: number }>;
}
