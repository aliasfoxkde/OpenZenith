/**
 * Shared layer system types for Map (2D/MapLibre) and Globe (3D/CesiumJS).
 */

/**
 * Top-level grouping a data layer belongs to — one of hillshade, terrain,
 * atmosphere, hazards, ocean, aviation, infrastructure, imagery, space, hydro,
 * weather, maritime, geocoding, or intelligence.
 */
export type LayerCategory =
  | "hillshade"
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
  | "geocoding"
  | "intelligence";

/**
 * Definition of one mountable data layer: its stable id, display name,
 * category, description, whether it is enabled by default, the accent colour
 * of its toggle indicator, the optional API endpoint its data comes from, and
 * the optional client-side render/remove hooks for MapLibre and Cesium plus
 * a custom data fetcher.
 */
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

/** Map of layer id to whether that layer is currently switched on. */
export interface LayerToggleState {
  [layerId: string]: boolean;
}

/** Cursor position readout: latitude and longitude in degrees plus the current map zoom level. */
export interface CoordinateReadout {
  lat: number;
  lon: number;
  zoom: number;
}

/** A single GeoJSON Feature: its geometry type and coordinates plus a free-form property bag. */
export interface GeoFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, unknown>;
}

/** A GeoJSON FeatureCollection holding an array of GeoJSON Features. */
export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}
