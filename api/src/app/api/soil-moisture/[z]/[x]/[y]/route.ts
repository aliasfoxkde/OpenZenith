/**
 * Soil Moisture tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS SMAP L3 Active Soil Moisture.
 * Shows L-band radar soil moisture from NASA's SMAP satellite.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
 */

import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "SMAP_L3_Active_Soil_Moisture",
  cachePrefix: "soil-moisture",
  minZoom: 0,
  maxZoom: 3,
  cacheTtl: 86400, // 24h — SMAP revisits every 2-3 days
});
