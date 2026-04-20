import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "GEDI_ISS_L3_Canopy_Height_Mean_RH100_201904-202303",
  cachePrefix: "canopy-height",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — static multi-year mean
});
