/**
 * NO₂ Air Pollution tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS TROPOMI L2 Nitrogen Dioxide Tropospheric Column.
 * Tracks NO₂ pollution from industrial activity, traffic, and wildfires.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
 */

import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column",
  cachePrefix: "no2-pollution",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 3600, // 1h — atmospheric data, frequent updates
});
