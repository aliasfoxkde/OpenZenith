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

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "MODIS_Terra_L3_Snow_Extent_8Day",
  cachePrefix: "snow-cover",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — 8-day composite
});
