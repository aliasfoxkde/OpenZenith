/**
 * Shared layer system types for Map (2D/MapLibre) and Globe (3D/CesiumJS).
 */

export type LayerCategory =
  | "terrain"
  | "atmosphere"
  | "hazards"
  | "ocean"
  | "aviation"
  | "infrastructure"
  | "imagery"
  | "space"
  | "hydro"
  | "weather"
  | "maritime"
  | "geocoding";

export interface LayerDefinition {
  id: string;
  name: string;
  category: LayerCategory;
  description: string;
  defaultEnabled: boolean;
  /** Color for the layer toggle indicator (hex) */
  accent: string;
  /** API endpoint to fetch data from (if applicable) */
  dataSource?: string;
  /** MapLibre GL map type — used for render/remove signatures */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderMapLibre?: (map: any, data: unknown) => void;
  removeMapLibre?: (map: unknown) => void;
  /** CesiumJS viewer type — used for render/remove signatures */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderCesium?: (viewer: any, data: unknown) => void;
  removeCesium?: (viewer: unknown) => void;
  /** Custom data fetcher. If omitted, uses dataSource with GET. */
  fetchData?: () => Promise<unknown>;
}

export interface LayerToggleState {
  [layerId: string]: boolean;
}

export interface CoordinateReadout {
  lat: number;
  lon: number;
  zoom: number;
}

export interface GeoFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, unknown>;
}

export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}
