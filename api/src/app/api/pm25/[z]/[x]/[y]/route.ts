import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "Particulate_Matter_Below_2.5micrometers_2010-2012",
  cachePrefix: "pm25",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 604800, // 7 days — multi-year mean, changes slowly
});
