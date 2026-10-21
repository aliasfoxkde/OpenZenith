/**
 * NASA GIBS sea surface salinity raster tiles.
 *
 * GET /api/sea-salinity/{z}/{x}/{y} - 256px PNG, zooms 0-5.
 * Upstream: NASA GIBS WMS (SMAP L3 monthly CAP), EPSG:3857.
 * Caching: Workers Cache API under prefix "sea-salinity", then
 * Cache-Control: public, max-age=604800 (monthly composite).
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
 * GET handler for the NASA GIBS SMAP L3 monthly sea surface salinity layer.
 *
 * Layer id: SMAP_L3_Sea_Surface_Salinity_CAP_Monthly.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-5), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "sea-salinity" cache prefix for the monthly salinity composite.
 */
export const GET = createGIBSHandler({
  layer: "SMAP_L3_Sea_Surface_Salinity_CAP_Monthly",
  cachePrefix: "sea-salinity",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 604800, // 7 days — monthly composite
});
