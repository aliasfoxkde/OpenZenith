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

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "MODIS_Aqua_AOD_Deep_Blue_Combined",
  cachePrefix: "aod",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 86400, // 24h — aerosol optical depth, daily
});
