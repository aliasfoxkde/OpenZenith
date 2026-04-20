/**
 * SO₂ Volcanic tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS TROPOMI L2 Sulfur Dioxide Total Vertical Column.
 * Tracks volcanic SO₂ emissions for eruption monitoring and aviation safety.
 * Uses EPSG:3857 Web Mercator for XYZ tile compatibility.
 */

import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column",
  cachePrefix: "so2-volcanic",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 3600, // 1h — atmospheric monitoring, updates frequently
});
