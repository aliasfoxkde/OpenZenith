import type { LayerHandle } from "./types";
import { addRasterLayer, removeRasterLayer, type RasterLayerSpec } from "./raster-factory";

/* ─── Bathymetry (Ocean Depth) ─── */

const bathymetrySpec: RasterLayerSpec = {
  sourceId: "bathymetry",
  tiles: ["/api/elevation-color/{z}/{x}/{y}"],
  opacity: 0.55,
  minzoom: 0,
  maxzoom: 10,
  layerId: "bathymetry",
  paint: {
    "raster-saturation": 0.3,
    "raster-contrast": 0.3,
    "raster-brightness-max": 0.75,
    "raster-brightness-min": 0.3,
  },
};

/**
 * Add the bathymetry raster overlay via the shared raster factory
 * (tiles/zooms/opacity in the spec above). Status is reported on the handle under the "bathymetry" id.
 */
export function addBathymetry(map: maplibregl.Map, handle: LayerHandle): void {
  addRasterLayer(map, handle, bathymetrySpec);
}
/** Remove the bathymetry raster layer and its source, ignoring errors. */
export function removeBathymetry(map: maplibregl.Map): void {
  removeRasterLayer(map, "bathymetry", "bathymetry");
}
