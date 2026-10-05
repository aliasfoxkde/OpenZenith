/**
 * NASA GIBS canopy height raster tiles.
 *
 * GET /api/canopy-height/{z}/{x}/{y} - 256px PNG, zooms 0-8.
 * Upstream: NASA GIBS WMS (GEDI ISS L3 mean RH100, 2019-04 to 2023-03),
 * EPSG:3857. Caching: Workers Cache API under prefix "canopy-height", then
 * Cache-Control: public, max-age=604800 (static multi-year mean).
 */
import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "GEDI_ISS_L3_Canopy_Height_Mean_RH100_201904-202303",
  cachePrefix: "canopy-height",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — static multi-year mean
});
