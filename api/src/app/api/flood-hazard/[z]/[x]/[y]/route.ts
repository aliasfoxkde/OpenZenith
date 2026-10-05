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

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "NDH_Flood_Hazard_Frequency_Distribution_1985-2003",
  cachePrefix: "flood-hazard",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — static historical data
});
