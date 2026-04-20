import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "JPL_MEaSUREs_L4_Sea_Surface_Height_Anomalies",
  cachePrefix: "sea-height",
  minZoom: 0,
  maxZoom: 6,
  cacheTtl: 86400, // 24h — daily anomaly data
});
