/**
 * Dynamic Surface Water Extent tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS OPERA L3 Dynamic Surface Water Extent (Sentinel-1).
 * Shows surface water dynamics including flooding, seasonal variations, and permanent water.
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
 * GET handler for the NASA GIBS OPERA L3 dynamic surface water extent from Sentinel-1 layer.
 *
 * Layer id: OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-9), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "dynamic-surface-water" cache prefix for the daily water-extent product.
 */
export const GET = createGIBSHandler({
  layer: "OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1",
  cachePrefix: "dynamic-surface-water",
  minZoom: 0,
  maxZoom: 9,
  cacheTtl: 86400, // 24h — water extent changes daily
});
