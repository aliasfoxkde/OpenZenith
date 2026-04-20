/**
 * Precipitation Rate tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS IMERG Precipitation Rate.
 * Shows global precipitation from the Integrated Multi-satellitE Retrievals for GPM.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
 */

import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "IMERG_Precipitation_Rate",
  cachePrefix: "precipitation",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 3600, // 1h — precipitation is highly dynamic
});
