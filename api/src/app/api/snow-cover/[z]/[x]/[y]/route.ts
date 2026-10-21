/**
 * NASA GIBS snow extent raster tiles.
 *
 * GET /api/snow-cover/{z}/{x}/{y} - 256px PNG, zooms 0-8.
 * Upstream: NASA GIBS WMS (MODIS Terra L3 8-day snow extent), EPSG:3857.
 * Caching: Workers Cache API under prefix "snow-cover", then
 * Cache-Control: public, max-age=604800 (8-day composite).
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
 * GET handler for the NASA GIBS MODIS Terra L3 8-day snow extent layer.
 *
 * Layer id: MODIS_Terra_L3_Snow_Extent_8Day.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-8), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "snow-cover" cache prefix for the 8-day snow composite.
 */
export const GET = createGIBSHandler({
  layer: "MODIS_Terra_L3_Snow_Extent_8Day",
  cachePrefix: "snow-cover",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — 8-day composite
});
