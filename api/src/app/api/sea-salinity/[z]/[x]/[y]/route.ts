import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "SMAP_L3_Sea_Surface_Salinity_CAP_Monthly",
  cachePrefix: "sea-salinity",
  minZoom: 0,
  maxZoom: 5,
  cacheTtl: 604800, // 7 days — monthly composite
});
