/**
 * Soil Moisture tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS SMAP L3 Active Soil Moisture.
 * Shows L-band radar soil moisture from NASA's SMAP satellite.
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
 * GET handler for the NASA GIBS SMAP L3 active soil moisture layer.
 *
 * Layer id: SMAP_L3_Active_Soil_Moisture.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-3), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "soil-moisture" cache prefix for the SMAP 2-3 day revisit cycle.
 */
export const GET = createGIBSHandler({
  layer: "SMAP_L3_Active_Soil_Moisture",
  cachePrefix: "soil-moisture",
  minZoom: 0,
  maxZoom: 3,
  cacheTtl: 86400, // 24h — SMAP revisits every 2-3 days
});
