import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "MODIS_Aqua_L2_Chlorophyll_A",
  cachePrefix: "chlorophyll",
  minZoom: 0,
  maxZoom: 7,
  cacheTtl: 86400, // 24h — daily ocean color
});
