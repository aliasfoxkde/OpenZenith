import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "NDH_Drought_Hazard_Frequency_Distribution_1980-2000",
  cachePrefix: "drought-hazard",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — static historical data
});
