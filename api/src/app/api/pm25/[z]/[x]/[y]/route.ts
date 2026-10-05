/**
 * NASA GIBS fine particulate matter (PM2.5) raster tiles.
 *
 * GET /api/pm25/{z}/{x}/{y} - 256px PNG, zooms 0-5.
 * Upstream: NASA GIBS WMS (Particulate Matter < 2.5um, 2010-2012), EPSG:3857.
 * Caching: Workers Cache API under prefix "pm25", then
 * Cache-Control: public, max-age=604800 (multi-year mean, changes slowly).
 */
import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "Particulate_Matter_Below_2.5micrometers_2010-2012",
  cachePrefix: "pm25",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 604800, // 7 days — multi-year mean, changes slowly
});
