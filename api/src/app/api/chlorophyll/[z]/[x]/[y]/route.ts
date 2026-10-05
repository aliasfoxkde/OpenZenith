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

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "MODIS_Aqua_L2_Chlorophyll_A",
  cachePrefix: "chlorophyll",
  minZoom: 0,
  maxZoom: 7,
  cacheTtl: 86400, // 24h — daily ocean color
});
