/**
 * NASA GIBS aerosol optical depth raster tiles.
 *
 * GET /api/aod/{z}/{x}/{y} - 256px PNG, zooms 0-5.
 * Upstream: NASA GIBS WMS (MODIS Aqua Deep Blue Combined), EPSG:3857.
 * Caching: Workers Cache API under prefix "aod", then
 * Cache-Control: public, max-age=86400 (daily product).
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
 * GET handler for the NASA GIBS MODIS Aqua Deep Blue combined aerosol optical depth layer.
 *
 * Layer id: MODIS_Aqua_AOD_Deep_Blue_Combined.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-5), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "aod" cache prefix for the daily aerosol optical depth product.
 */
export const GET = createGIBSHandler({
  layer: "MODIS_Aqua_AOD_Deep_Blue_Combined",
  cachePrefix: "aod",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 86400, // 24h — aerosol optical depth, daily
});
