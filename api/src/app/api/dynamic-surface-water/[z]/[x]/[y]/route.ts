/**
 * Dynamic Surface Water Extent tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS OPERA L3 Dynamic Surface Water Extent (Sentinel-1).
 * Shows surface water dynamics including flooding, seasonal variations, and permanent water.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
 */

import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1",
  cachePrefix: "dynamic-surface-water",
  minZoom: 0,
  maxZoom: 9,
  cacheTtl: 86400, // 24h — water extent changes daily
});
