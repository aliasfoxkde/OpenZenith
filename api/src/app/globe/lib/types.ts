/**
 * Per-layer visibility flags for the globe, one boolean keyed by layer id.
 * The key strings are load-bearing beyond this object: they are the `l=`
 * tokens accepted by parseHash/buildHash and the `layerIds` listed in
 * SIDEBAR_SECTIONS. Watch the near-pair: `satellite` is the raster imagery
 * layer (blue marble / night lights style overlays) while plural `satellites`
 * is the space-objects layer. Only the three defaults in DEFAULT_LAYERS start
 * true; everything here is false unless turned on.
 */
export interface LayerState {
  earthquakes: boolean;
  radar: boolean;
  satellite: boolean;
  flights: boolean;
  militaryFlights: boolean;
  vessels: boolean;
  warnings: boolean;
  events: boolean;
  satellites: boolean;
  hillshade: boolean;
  elevationColor: boolean;
  hurricaneTracks: boolean;
  blueMarble: boolean;
  nightLights: boolean;
  nlnogNodes: boolean;
  flightArcs: boolean;
  orbitalTracks: boolean;
  groundTracks: boolean;
  currents: boolean;
  spaceWeather: boolean;
  airQuality: boolean;
  aviationWeather: boolean;
  volcanoes: boolean;
  gdacs: boolean;
  marineWeather: boolean;
  wildfires: boolean;
  lightning: boolean;
  /** GPS Jamming hex grid - electronic warfare detection */
  gpsJamming: boolean;
  /** Day/Night terminator overlay */
  dayNight: boolean;
  /** Elevation data source coverage heatmap */
  coverage: boolean;
}

/**
 * The full globe UI state — the shape the URL hash encodes (buildHash /
 * parseHash), the shape persisted across visits, and what the sidebar edits.
 * `center` is [longitude, latitude] in degrees (longitude first), `zoom` is
 * the MapLibre-style estimate the page derives from camera height as
 * log2(40075016 / heightM), `basemap` is a BASEMAPS registry key, `theme` a
 * THEMES key, and `viewMode` selects the Cesium projection morphed to on
 * switch ("3d" → morphTo3D, "2d" → morphTo2D, "columbus" → columbus view).
 */
export interface DashboardState {
  center: [number, number];
  zoom: number;
  basemap: string;
  layers: LayerState;
  theme: string;
  viewMode: "3d" | "2d" | "columbus";
}

/**
 * Health row for one tracked layer, rendered in the status bar: `key` (the id
 * updateStatus patches by — must be a LayerState key so the bar can look up
 * whether the layer is active), `label` (display text), `lastUpdate` (epoch ms
 * of the last successful load, null until one succeeds), `count` (features or
 * entities rendered), and `error` (short failure message, null when healthy).
 * The status bar derives its indicator from this: error → red, lastUpdate →
 * ok, otherwise loading; rows for inactive, error-free layers are hidden.
 */
export interface DataStatus {
  key: string;
  label: string;
  lastUpdate: number | null;
  count: number;
  error: string | null;
}
