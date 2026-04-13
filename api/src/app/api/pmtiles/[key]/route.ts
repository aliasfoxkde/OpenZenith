/**
 * PMTiles serving endpoint.
 *
 * Previously served PMTiles files from R2. R2 storage has been removed;
 * terrain tiles are now served via /api/dem-tile/{z}/{x}/{y} using
 * HuggingFace SRTM 30m chunk datasets.
 *
 * Returns 410 (Gone) to indicate this endpoint is no longer available.
 */

import { NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET() {
  return NextResponse.json(
    {
      error: "PMTiles endpoint deprecated",
      message: "Terrain tiles are now served via /api/dem-tile/{z}/{x}/{y} using HuggingFace SRTM 30m chunks.",
      alternatives: [
        { type: "dem-tiles", url: "/api/dem-tile/{z}/{x}/{y}", format: "Terrarium PNG" },
        { type: "ogc-tiles", url: "/api/tiles/WebMercatorQuad/{z}/{x}/{y}", format: "OGC API Tiles" },
        { type: "elevation", url: "/api/elevation?lat={lat}&lon={lon}", format: "JSON" },
      ],
    },
    {
      status: 410,
      headers: CORS_HEADERS,
    },
  );
}
