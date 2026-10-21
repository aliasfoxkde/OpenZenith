/**
 * NASA GIBS ocean chlorophyll-a raster tiles.
 *
 * GET /api/chlorophyll/{z}/{x}/{y} - 256px PNG, zooms 0-7.
 * Upstream: NASA GIBS WMS (MODIS Aqua L2 Chlorophyll A), EPSG:3857.
 * Caching: Workers Cache API under prefix "chlorophyll", then
 * Cache-Control: public, max-age=86400 (daily ocean color).
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
 * GET handler for the NASA GIBS MODIS Aqua L2 ocean chlorophyll-a concentration layer.
 *
 * Layer id: MODIS_Aqua_L2_Chlorophyll_A.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-7), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "chlorophyll" cache prefix for the daily ocean-colour product.
 */
export const GET = createGIBSHandler({
  layer: "MODIS_Aqua_L2_Chlorophyll_A",
  cachePrefix: "chlorophyll",
  minZoom: 0,
  maxZoom: 7,
  cacheTtl: 86400, // 24h — daily ocean color
});
