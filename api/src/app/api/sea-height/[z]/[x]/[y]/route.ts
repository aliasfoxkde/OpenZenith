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

/**
 * Marks this route for the Cloudflare edge runtime, where the Workers
 * Cache API that fronts the upstream data is available.
 */
export const runtime = "edge";
/**
 * Answers the CORS preflight for this tile route with a 204 and the shared
 * CORS headers, so browser clients may request the tiles cross-origin.
 */
export const OPTIONS = () => corsPreflightResponse();
/**
 * GET handler for the NASA GIBS JPL MEaSUREs L4 sea surface height anomaly layer.
 *
 * Layer id: JPL_MEaSUREs_L4_Sea_Surface_Height_Anomalies.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-6), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "sea-height" cache prefix for the daily anomaly product.
 */
export const GET = createGIBSHandler({
  layer: "JPL_MEaSUREs_L4_Sea_Surface_Height_Anomalies",
  cachePrefix: "sea-height",
  minZoom: 0,
  maxZoom: 6,
  cacheTtl: 86400, // 24h — daily anomaly data
});
