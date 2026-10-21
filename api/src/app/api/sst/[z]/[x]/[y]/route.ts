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
 * GET handler for the NASA GIBS GHRSST L4 MUR 1km sea surface temperature layer.
 *
 * Layer id: GHRSST_L4_MUR25_Sea_Surface_Temperature.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-8), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "sst" cache prefix for the daily sea-surface temperature composite.
 */
export const GET = createGIBSHandler({
  layer: "GHRSST_L4_MUR25_Sea_Surface_Temperature",
  cachePrefix: "sst",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 86400, // 24h — daily SST composite
});
