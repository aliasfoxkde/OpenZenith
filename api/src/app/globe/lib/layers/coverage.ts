/**
 * Elevation Data Source Coverage layer for the CesiumJS globe.
 *
 * Overlays a colour-coded heatmap showing which elevation dataset covers
 * each area of the globe:
 *   - ArcticDEM 2m  (cyan, >60°N)
 *   - REMA 2m      (cyan, <-60°S)
 *   - Copernicus EEA 10m (green, Europe)
 *   - SRTM/GLO-30 30m   (dark green, ±60° lat land)
 *   - GLO-90 90m   (yellow-green, rest of land)
 *   - GEBCO 450m ocean  (blue)
 *   - Dark grey = no data
 *
 * Tile endpoint: /api/elevation-accuracy/{z}/{x}/{y}
 */

const _LAYER_ID = "elevation-coverage";
const TILE_URL = "/api/elevation-accuracy/{z}/{x}/{y}";

/**
 * Structural view of one entry of Cesium's private
 * `ImageryLayerCollection._layers` backing array, which removeCoverage walks to
 * find the layer carrying this file's provider — the public collection surface
 * offers no lookup by provider.
 */
interface CoverageImageryLayer {
  _imageryProvider?: unknown;
  alpha: number;
  show: boolean;
}

/** The public collection surface plus the private `_layers` array. */
type CoverageLayerCollection = CesiumType.ImageryLayerCollection & {
  _layers: CoverageImageryLayer[];
};

let coverageProvider: CesiumType.UrlTemplateImageryProvider | null = null;

/**
 * Add the coverage imagery overlay to the CesiumJS viewer.
 */
export function addCoverage(viewer: CesiumType.Viewer, Cesium: typeof CesiumType): void {
  if (coverageProvider) return; // already added

  const tilingScheme = new Cesium.GeographicTilingScheme({
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
  });

  // Held in a typed local rather than an inline literal: the ambient
  // constructor options omit tilingScheme/minimumLevel, and an inline literal
  // would fail the excess-property check for options Cesium itself accepts.
  const providerOptions: {
    url: string;
    tilingScheme: CesiumType.GeographicTilingScheme;
    minimumLevel: number;
    maximumLevel: number;
    credit: string;
  } = { url: TILE_URL, tilingScheme, minimumLevel: 0, maximumLevel: 12, credit: "" };

  coverageProvider = new Cesium.UrlTemplateImageryProvider(providerOptions);

  // Add at low alpha — this is an overlay, not a basemap
  const layer = viewer.imageryLayers.addImageryProvider(coverageProvider);
  layer.alpha = 0.35;
  layer.show = true;
}

/**
 * Remove the coverage imagery overlay from the CesiumJS viewer.
 */
export function removeCoverage(viewer: CesiumType.Viewer): void {
  if (!coverageProvider) return;
  const layers = viewer.imageryLayers as CoverageLayerCollection;
  const existing = layers._layers.find((l) => l._imageryProvider === coverageProvider);
  if (existing) {
    layers.remove(existing);
  }
  coverageProvider = null;
}
