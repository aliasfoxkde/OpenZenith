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

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "MODIS_Terra_L3_NDVI_16Day",
  cachePrefix: "ndvi",
  minZoom: 0,
  maxZoom: 9,
  cacheTtl: 604800, // 7 days — 16-day composite, changes slowly
});
