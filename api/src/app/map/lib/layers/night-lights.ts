import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Night Lights (NASA Black Marble) ─── */

const nightLightsSpec: RasterLayerSpec = {
  sourceId: "nightLights",
  tiles: [
    "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/BlackMarble_ShadedRelief/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
  ],
  opacity: 0.85,
  minzoom: 0,
  maxzoom: 8,
  paint: { "raster-brightness-max": 1.2 },
  attribution: "NASA Black Marble",
};

/**
 * Add the nightLights raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above), reporting "loaded"/"error" on the
 * handle under the source id.
 */
export function addNightLights(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, nightLightsSpec);
}
/** Remove the nightLights raster layer and its source, ignoring errors. */
export function removeNightLights(map: maplibregl.Map): void {
  removeRasterLayer(map, "nightLights");
}
