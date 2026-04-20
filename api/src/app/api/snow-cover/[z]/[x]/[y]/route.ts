import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "MODIS_Terra_L3_Snow_Extent_8Day",
  cachePrefix: "snow-cover",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 604800, // 7 days — 8-day composite
});
