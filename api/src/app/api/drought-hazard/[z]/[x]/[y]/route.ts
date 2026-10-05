/**
 * NASA GIBS drought hazard frequency raster tiles.
 *
 * GET /api/drought-hazard/{z}/{x}/{y} - 256px PNG, zooms 0-8.
 * Upstream: NASA GIBS WMS (NDH Drought Hazard Frequency 1980-2000), EPSG:3857.
 * Caching: Workers Cache API under prefix "drought-hazard", then
 * Cache-Control: public, max-age=604800 (static historical data).
 */
import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "NDH_Drought_Hazard_Frequency_Distribution_1980-2000",
  cachePrefix: "drought-hazard",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — static historical data
});
