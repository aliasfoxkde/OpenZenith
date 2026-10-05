/**
 * NASA GIBS sea surface height anomaly raster tiles.
 *
 * GET /api/sea-height/{z}/{x}/{y} - 256px PNG, zooms 0-6.
 * Upstream: NASA GIBS WMS (JPL MEaSUREs L4 anomalies), EPSG:3857.
 * Caching: Workers Cache API under prefix "sea-height", then
 * Cache-Control: public, max-age=86400 (daily anomaly product).
 */
import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "JPL_MEaSUREs_L4_Sea_Surface_Height_Anomalies",
  cachePrefix: "sea-height",
  minZoom: 0,
  maxZoom: 6,
  cacheTtl: 86400, // 24h — daily anomaly data
});
