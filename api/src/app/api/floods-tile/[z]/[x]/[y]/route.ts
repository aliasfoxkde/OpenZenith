/**
 * Flood extent tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS VIIRS Combined 3-Day Flood product.
 * Replaces Copernicus EMS Rapid Mapping (discontinued 2025).
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
 * GET handler for the NASA GIBS VIIRS combined 3-day flood product layer.
 *
 * Layer id: VIIRS_Combined_Flood_3-Day.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-9), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "floods-tile" cache prefix for the daily flood-monitoring product.
 */
export const GET = createGIBSHandler({
  layer: "VIIRS_Combined_Flood_3-Day",
  cachePrefix: "floods-tile",
  minZoom: 0,
  maxZoom: 9,
  cacheTtl: 86400, // 24h — daily flood monitoring
});
