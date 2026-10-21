/**
 * NO₂ Air Pollution tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS TROPOMI L2 Nitrogen Dioxide Tropospheric Column.
 * Tracks NO₂ pollution from industrial activity, traffic, and wildfires.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
 */

import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

/**
 * Marks this route for the Cloudflare edge runtime, where the Workers
 * Cache API that fronts the upstream data is available.
 */
export const runtime = "edge";
/**
 * Answers the CORS preflight for this tile route with a 204 and the shared
 * CORS headers, so browser clients may request the tiles cross-origin.
 */
export const OPTIONS = () => corsPreflightResponse();
/**
 * GET handler for the NASA GIBS TROPOMI L2 tropospheric nitrogen dioxide column layer.
 *
 * Layer id: TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-5), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "no2-pollution" cache prefix for the frequently refreshed atmospheric column.
 */
export const GET = createGIBSHandler({
  layer: "TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column",
  cachePrefix: "no2-pollution",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 3600, // 1h — atmospheric data, frequent updates
});
