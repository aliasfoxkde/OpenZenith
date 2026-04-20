/**
 * SAR backscatter tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS OPERA L2 Radiometric Terrain-Corrected SAR (Sentinel-1).
 * Provides actual SAR imagery (VV/VH backscatter) from the OPERA project at NASA JPL.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
 */

import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1",
  cachePrefix: "sar-backscatter",
  minZoom: 1,
  maxZoom: 10,
  cacheTtl: 604800, // 7 days — SAR revisit is 6-12 days
});
