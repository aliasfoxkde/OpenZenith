/**
 * Fire temperature tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS GOES-East ABI Fire Temperature product.
 * Provides real-time fire hotspot detection from GOES-16 geostationary satellite.
 * Complements FIRMS VIIRS wildfire points with thermal imagery.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
 */

import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "GOES-East_ABI_FireTemp",
  cachePrefix: "fire-temperature",
  minZoom: 1,
  maxZoom: 9,
  cacheTtl: 3600, // 1h — fire temperature updates frequently
});
