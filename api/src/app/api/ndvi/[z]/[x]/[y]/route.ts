/**
 * NDVI (Normalized Difference Vegetation Index) tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS MODIS Terra L3 NDVI 16-Day composite.
 * Shows vegetation health and density globally. Key indicator for drought,
 * deforestation, agricultural monitoring, and climate change.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
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
 * GET handler for the NASA GIBS MODIS Terra L3 16-day NDVI composite layer.
 *
 * Layer id: MODIS_Terra_L3_NDVI_16Day.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (0-9), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "ndvi" cache prefix for the slowly changing 16-day vegetation composite.
 */
export const GET = createGIBSHandler({
  layer: "MODIS_Terra_L3_NDVI_16Day",
  cachePrefix: "ndvi",
  minZoom: 0,
  maxZoom: 9,
  cacheTtl: 604800, // 7 days — 16-day composite, changes slowly
});
