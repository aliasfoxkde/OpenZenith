/**
 * NASA GIBS flood hazard frequency raster tiles.
 *
 * GET /api/flood-hazard/{z}/{x}/{y} - 256px PNG, zooms 0-8.
 * Upstream: NASA GIBS WMS (NDH Flood Hazard Frequency 1985-2003), EPSG:3857.
 * Caching: Workers Cache API under prefix "flood-hazard", then
 * Cache-Control: public, max-age=604800 (static historical data).
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
 * GET handler for the NASA GIBS NDH flood hazard frequency distribution layer.
 *
 * Layer id: NDH_Flood_Hazard_Frequency_Distribution_1985-2003.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-8), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "flood-hazard" cache prefix for the static historical hazard distribution.
 */
export const GET = createGIBSHandler({
  layer: "NDH_Flood_Hazard_Frequency_Distribution_1985-2003",
  cachePrefix: "flood-hazard",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — static historical data
});
