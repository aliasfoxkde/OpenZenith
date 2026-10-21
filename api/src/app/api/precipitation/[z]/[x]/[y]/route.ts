/**
 * Precipitation Rate tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS IMERG Precipitation Rate.
 * Shows global precipitation from the Integrated Multi-satellitE Retrievals for GPM.
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
 * GET handler for the NASA GIBS IMERG precipitation rate layer.
 *
 * Layer id: IMERG_Precipitation_Rate.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-8), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "precipitation" cache prefix for the highly dynamic precipitation rate field.
 */
export const GET = createGIBSHandler({
  layer: "IMERG_Precipitation_Rate",
  cachePrefix: "precipitation",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 3600, // 1h — precipitation is highly dynamic
});
