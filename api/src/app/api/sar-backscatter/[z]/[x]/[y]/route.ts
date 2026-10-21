/**
 * SAR backscatter tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS OPERA L2 Radiometric Terrain-Corrected SAR (Sentinel-1).
 * Provides actual SAR imagery (VV/VH backscatter) from the OPERA project at NASA JPL.
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
 * GET handler for the NASA GIBS OPERA L2 terrain-corrected Sentinel-1 SAR backscatter layer.
 *
 * Layer id: OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1.
 *
 * Validates the {z}/{x}/{y} path parameters against the supported zoom range
 * (1-10), serves the 256px EPSG:3857 PNG from the edge cache when it is
 * present, and otherwise proxies a WMS GetMap request to NASA GIBS and stores
 * the result under the "sar-backscatter" cache prefix for the 6-12 day SAR revisit cycle.
 */
export const GET = createGIBSHandler({
  layer: "OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1",
  cachePrefix: "sar-backscatter",
  minZoom: 1,
  maxZoom: 10,
  cacheTtl: 604800, // 7 days — SAR revisit is 6-12 days
});
