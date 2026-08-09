/* eslint-disable @typescript-eslint/no-explicit-any */
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

const LAYER_ID = "elevation-coverage";
const TILE_URL = "/api/elevation-accuracy/{z}/{x}/{y}";

let coverageProvider: any = null;

/**
 * Add the coverage imagery overlay to the CesiumJS viewer.
 */
export function addCoverage(viewer: any, Cesium: any): void {
  if (coverageProvider) return; // already added

  const tilingScheme = new Cesium.GeographicTilingScheme({
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
  });

  coverageProvider = new Cesium.UrlTemplateImageryProvider({
    url: TILE_URL,
    tilingScheme,
    minimumLevel: 0,
    maximumLevel: 12,
    credit: "",
  });

  // Add at low alpha — this is an overlay, not a basemap
  const layerIndex = viewer.imageryLayers.addImageryProvider(coverageProvider);
  const layer = viewer.imageryLayers.get(layerIndex);
  layer.alpha = 0.35;
  layer.show = true;
}

/**
 * Remove the coverage imagery overlay from the CesiumJS viewer.
 */
export function removeCoverage(viewer: any): void {
  if (!coverageProvider) return;
  const layers = viewer.imageryLayers;
  const existing = layers._layers.find((l: any) => l._imageryProvider === coverageProvider);
  if (existing) {
    layers.remove(existing);
  }
  coverageProvider = null;
}
