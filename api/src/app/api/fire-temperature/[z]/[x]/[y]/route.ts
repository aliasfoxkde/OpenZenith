/**
 * Fire temperature tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS GOES-East ABI Fire Temperature product.
 * Provides real-time fire hotspot detection from GOES-16 geostationary satellite.
 * Complements FIRMS VIIRS wildfire points with thermal imagery.
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
 * GET handler for the NASA GIBS GOES-East ABI fire temperature layer.
 *
 * Layer id: GOES-East_ABI_FireTemp.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (1-9), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "fire-temperature" cache prefix for the frequently refreshed fire-temperature imagery.
 */
export const GET = createGIBSHandler({
  layer: "GOES-East_ABI_FireTemp",
  cachePrefix: "fire-temperature",
  minZoom: 1,
  maxZoom: 9,
  cacheTtl: 3600, // 1h — fire temperature updates frequently
});
