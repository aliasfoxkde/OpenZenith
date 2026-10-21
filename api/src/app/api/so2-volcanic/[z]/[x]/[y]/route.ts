/**
 * SO₂ Volcanic tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS TROPOMI L2 Sulfur Dioxide Total Vertical Column.
 * Tracks volcanic SO₂ emissions for eruption monitoring and aviation safety.
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
 * GET handler for the NASA GIBS TROPOMI L2 total vertical sulfur dioxide column layer.
 *
 * Layer id: TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-5), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "so2-volcanic" cache prefix for the frequently refreshed atmospheric column.
 */
export const GET = createGIBSHandler({
  layer: "TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column",
  cachePrefix: "so2-volcanic",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 3600, // 1h — atmospheric monitoring, updates frequently
});
