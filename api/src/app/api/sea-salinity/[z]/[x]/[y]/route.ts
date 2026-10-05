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

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "SMAP_L3_Sea_Surface_Salinity_CAP_Monthly",
  cachePrefix: "sea-salinity",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 604800, // 7 days — monthly composite
});
