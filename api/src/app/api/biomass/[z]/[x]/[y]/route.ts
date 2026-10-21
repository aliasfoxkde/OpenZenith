/**
 * NASA GIBS above-ground biomass density raster tiles.
 *
 * GET /api/biomass/{z}/{x}/{y} - 256px PNG, zooms 0-8.
 * Upstream: NASA GIBS WMS (GEDI ISS L4B mean, 2019-04 to 2023-03), EPSG:3857.
 * Caching: Workers Cache API under prefix "biomass", then
 * Cache-Control: public, max-age=604800 (static multi-year mean).
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
 * GET handler for the NASA GIBS GEDI ISS L4B mean above-ground biomass density layer.
 *
 * Layer id: GEDI_ISS_L4B_Aboveground_Biomass_Density_Mean_201904-202303.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-8), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "biomass" cache prefix for the static multi-year biomass mean.
 */
export const GET = createGIBSHandler({
  layer: "GEDI_ISS_L4B_Aboveground_Biomass_Density_Mean_201904-202303",
  cachePrefix: "biomass",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — static multi-year mean
});
