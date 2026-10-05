/**
 * NASA GIBS sea surface temperature raster tiles.
 *
 * GET /api/sst/{z}/{x}/{y} - 256px PNG, zooms 0-8.
 * Upstream: NASA GIBS WMS (GHRSST L4 MUR 1km), EPSG:3857.
 * Caching: Workers Cache API under prefix "sst", then
 * Cache-Control: public, max-age=86400 (daily SST composite).
 */
import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "GHRSST_L4_MUR25_Sea_Surface_Temperature",
  cachePrefix: "sst",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 86400, // 24h — daily SST composite
});
