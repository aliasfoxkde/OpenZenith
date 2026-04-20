import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "NDH_Landslide_Hazard_Distribution_2000",
  cachePrefix: "landslide-hazard",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — static historical data
});
