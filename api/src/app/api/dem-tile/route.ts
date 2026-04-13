import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/cors";

/**
 * DEM terrain provider metadata + health endpoint.
 *
 * GET /api/dem-tile — TileJSON metadata for CesiumJS/MapLibre
 * GET /api/dem-tile?health=1 — Tile source health check
 *
 * CesiumJS usage:
 *   new Cesium.CesiumTerrainProvider({ url: "/api/dem-tile" })
 *
 * MapLibre usage:
 *   map.addSource("dem", {
 *     type: "raster-dem",
 *     tiles: ["/api/dem-tile/{z}/{x}/{y}"],
 *     tileSize: 256,
 *     encoding: "terrarium",
 *   });
 */

export const runtime = "edge";

const TERRAIN_METADATA = {
  tilejson: "3.0.0" as const,
  tiles: ["/api/dem-tile/{z}/{x}/{y}"],
  minzoom: 0,
  maxzoom: 10,
  bounds: [-180, -90, 180, 90],
  center: [0, 0, 4],
  encoding: "terrarium" as const,
  format: "terrarium",
  tileFormat: "terrarium",
  available: true,
  version: "1.0.0",
  name: "OpenZenith Global DEM",
  description: "Global terrain assembled on-the-fly from HuggingFace SRTM 30m chunks.",
  attribution: "SRTM 30m via HuggingFace",
  scheme: "xyz",
};

export async function GET(request: NextRequest) {
  // Health check mode
  if (request.nextUrl.searchParams.get("health") === "1") {
    return handleHealthCheck();
  }

  return NextResponse.json(TERRAIN_METADATA, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "application/json",
    },
  });
}

async function handleHealthCheck() {
  // Verify HuggingFace backend is reachable by requesting a known chunk
  try {
    const url = "https://huggingface.co/datasets/aliasfox/srtm30m-merged/resolve/main/N35/N35W120.merged";
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });

    if (res.ok || res.status === 302) {
      return NextResponse.json(
        {
          status: "ok",
          backend: "huggingface",
          repo: "aliasfox/srtm30m-merged",
          http_status: res.status,
          message: "HuggingFace SRTM 30m chunk backend is reachable",
        },
        {
          headers: {
            ...CORS_HEADERS,
            "Cache-Control": "no-cache",
          },
        },
      );
    }

    return NextResponse.json(
      {
        status: "degraded",
        backend: "huggingface",
        repo: "aliasfox/srtm30m-merged",
        message: `HuggingFace returned status ${res.status}`,
      },
      {
        status: 503,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-cache",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        backend: "huggingface",
        message: error instanceof Error ? error.message : "Health check failed",
      },
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-cache",
        },
      },
    );
  }
}
