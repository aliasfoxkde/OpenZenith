/**
 * NASA GIBS fine particulate matter (PM2.5) raster tiles.
 *
 * GET /api/pm25/{z}/{x}/{y} - 256px PNG, zooms 0-5.
 * Upstream: NASA GIBS WMS (Particulate Matter < 2.5um, 2010-2012), EPSG:3857.
 * Caching: Workers Cache API under prefix "pm25", then
 * Cache-Control: public, max-age=604800 (multi-year mean, changes slowly).
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
 * GET handler for the NASA GIBS fine particulate matter below 2.5 micrometres layer.
 *
 * Layer id: Particulate_Matter_Below_2.5micrometers_2010-2012.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-5), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "pm25" cache prefix for the slowly changing multi-year particulate mean.
 */
export const GET = createGIBSHandler({
  layer: "Particulate_Matter_Below_2.5micrometers_2010-2012",
  cachePrefix: "pm25",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 604800, // 7 days — multi-year mean, changes slowly
});
