/**
 * NASA GIBS landslide hazard raster tiles.
 *
 * GET /api/landslide-hazard/{z}/{x}/{y} - 256px PNG, zooms 0-8.
 * Upstream: NASA GIBS WMS (NDH Landslide Hazard Distribution 2000), EPSG:3857.
 * Caching: Workers Cache API under prefix "landslide-hazard", then
 * Cache-Control: public, max-age=604800 (static historical data).
 */
import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "NDH_Landslide_Hazard_Distribution_2000",
  cachePrefix: "landslide-hazard",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — static historical data
});
