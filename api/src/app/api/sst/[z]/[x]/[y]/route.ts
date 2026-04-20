import { corsPreflightResponse } from "@/lib/cors";
import { createGIBSHandler } from "@/lib/gibs-tile";

export const runtime = "edge";
export const OPTIONS = () => corsPreflightResponse();
export const GET = createGIBSHandler({
  layer: "GHRSST_L4_MUR25_Sea_Surface_Temperature",
  cachePrefix: "sst",
  minZoom: 0,
  maxZoom: 8,
  cacheTtl: 86400, // 24h — daily SST composite
});
