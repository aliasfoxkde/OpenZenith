import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "MODIS_Aqua_AOD_Deep_Blue_Combined",
  cachePrefix: "aod",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 86400, // 24h — aerosol optical depth, daily
});
