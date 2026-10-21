/**
 * Disturbance Alerts tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS OPERA L3 DIST-ALERT HLS Color Index.
 * Shows surface disturbance from fire, deforestation, urbanization, etc.
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
 * GET handler for the NASA GIBS OPERA L3 Disturbance Alert HLS colour index layer.
 *
 * Layer id: OPERA_L3_DIST-ALERT-HLS_Color_Index.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-8), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "disturbance-alerts" cache prefix for the daily disturbance-detection product.
 */
export const GET = createGIBSHandler({
  layer: "OPERA_L3_DIST-ALERT-HLS_Color_Index",
  cachePrefix: "disturbance-alerts",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 86400, // 24h — disturbance detection is daily
});
