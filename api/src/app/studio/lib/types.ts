/** Ids of the studio sidebar tabs, in the order the UI offers them; persisted as `activeTab`. */
export type ToolTab =
  "elevation" | "geocode" | "overpass" | "weather" | "data" | "layers" | "draw" | "tiles" | "flowpath";

/**
 * Live UI state of the studio shell: `activeTab` selects the open sidebar tool, `sidebarOpen`
 * is the expand/collapse flag, `dark` the theme flag, `cursorPos` the pointer position in
 * degrees (`{ lat, lon }`, null while the cursor is off the map), and `zoom` the current
 * MapLibre zoom level.
 */
export interface StudioState {
  activeTab: ToolTab;
  sidebarOpen: boolean;
  dark: boolean;
  cursorPos: { lat: number; lon: number } | null;
  zoom: number;
}

/** Palette family used to shade a dataset's numeric property when a mode colors by value. */
export type ColorRamp = "sequential" | "diverging" | "categorical";

/** How an uploaded dataset is drawn: one uniform color, shaded per feature, or a heat surface. */
export type VisualizationMode = "simple" | "choropleth" | "heatmap";

/**
 * Per-dataset render configuration: `mode` picks how features are drawn, `property` names the
 * feature attribute whose value drives choropleth/heatmap shading (null in "simple" mode), and
 * `colorRamp` is the palette applied to those values.
 */
export interface DatasetVisualization {
  mode: VisualizationMode;
  property: string | null;
  colorRamp: ColorRamp;
}

/**
 * One parsed import held in studio state. `id` is `dataset-<n>` from a per-session counter,
 * `name` is the original file name, `format` the detected parser label ("GeoJSON", "CSV",
 * "GPX", "KML", "Shapefile"), `featureCount` the number of features, `visible` the layer
 * toggle, `color` a hex from `DATASET_COLORS`, `data` the parsed FeatureCollection in
 * EPSG:4326 with `[lon, lat]` coordinates, and `visualization` the current render config.
 */
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

/**
 * One point-elevation lookup: `lat`/`lon` in degrees, `elevation` in meters above sea level
 * or null when the source tile has no data there, and the optional `surfaceType`
 * classification (e.g. "land", "ocean") reported by the elevation API.
 */
export interface ElevationResult {
  lat: number;
  lon: number;
  elevation: number | null;
  surfaceType?: string;
}

/**
 * One Nominatim geocode hit as returned by `/api/geocode`: `display_name` is the fully
 * formatted place name, `lat`/`lon` are degrees, `type` is Nominatim's place type
 * (e.g. "city"), and `importance` is Nominatim's 0-1 relevance score used for ranking.
 */
export interface GeocodeResult {
  display_name: string;
  lat: number;
  lon: number;
  type: string;
  importance: number;
}

/**
 * Shape of one entry in `OVERPASS_PRESETS`: a picker `label`, the Overpass QL `query` (may
 * embed a `{{bbox}}` placeholder the tool substitutes before POSTing), and a one-line
 * `description` of what the query returns.
 */
export interface OverpassPreset {
  label: string;
  query: string;
  description: string;
}

/**
 * A pin dropped on the map: `id` is a stable key for React rendering, `lat`/`lon` are degrees,
 * `label` is optional user text, and `elevation` is meters (or null when the lookup returned
 * no data, undefined while it is still pending).
 */
export interface MarkerPin {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  elevation?: number | null;
}

/**
 * Phase of the drawing state machine: `none` when idle, `point`/`line`/`polygon` while
 * collecting clicks, and `edit` when the selected feature's vertices are being manipulated.
 * "point" commits one feature per click, the others on explicit finish.
 */
export type DrawMode = "none" | "point" | "line" | "polygon" | "edit";

/**
 * The drawing tool's state. `features` holds committed GeoJSON features in EPSG:4326
 * `[lon, lat]` order (polygon rings closed on commit); `currentCoords` is the unclosed vertex
 * list of the in-progress shape, also `[lon, lat]`; `selectedFeatureIndex` and
 * `selectedVertexIndex` index into `features` and the selected feature's coordinates, with -1
 * meaning nothing selected; `history` and `redoStack` are the undo/redo stacks of prior
 * `features` snapshots, cleared on redo-able new work. Structurally identical to the twin
 * declared in `lib/drawing.ts` — components type against this one, the mutators against that.
 */
export interface DrawState {
  mode: DrawMode;
  features: GeoJSON.Feature[];
  currentCoords: [number, number][];
  selectedFeatureIndex: number;
  selectedVertexIndex: number;
  history: GeoJSON.Feature[][];
  redoStack: GeoJSON.Feature[][];
}
