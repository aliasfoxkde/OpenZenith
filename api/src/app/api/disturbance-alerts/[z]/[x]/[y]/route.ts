/**
 * Disturbance Alerts tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS OPERA L3 DIST-ALERT HLS Color Index.
 * Shows surface disturbance from fire, deforestation, urbanization, etc.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
 */

import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "OPERA_L3_DIST-ALERT-HLS_Color_Index",
  cachePrefix: "disturbance-alerts",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 86400, // 24h — disturbance detection is daily
});
