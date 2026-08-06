import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/cors";

/**
 * DEM terrain provider metadata + health endpoint.
 *
 * GET /api/dem-tile — TileJSON metadata for CesiumJS/MapLibre
 * GET /api/dem-tile?health=1 — Tile source health check
 *
 * Tile formats (use ?format= query param):
 *   ?format=ozt2 — OZT2 binary (default for CesiumJS globe, ~93% smaller than PNG)
 *   ?format=png  — Terrarium PNG (MapLibre raster-dem, legacy)
 *
 * OZT2 tiles are pre-generated and stored in R2. If not in R2, the API falls back
 * to PNG generation. CesiumJS terrain provider (terrain-ozt2.ts) auto-negotiates.
 *
 * CesiumJS usage (OZT2-first):
 *   new Cesium.CesiumTerrainProvider({ url: "/api/dem-tile" })
 *
 * MapLibre usage (PNG, Terrarium encoding):
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
  maxzoom: 12,
  bounds: [-180, -90, 180, 90],
  center: [0, 0, 4],
  encoding: "terrarium" as const,
  format: "terrarium",
  tileFormat: "ozt2",
  available: true,
  version: "2.0.0",
  name: "OpenZenith Global DEM",
  description:
    "OZT2 tiles (CesiumJS): pre-generated gradient+Brotli, ~93% smaller than PNG. " +
    "PNG tiles (MapLibre): on-the-fly Terrarium encoding from SRTM 30m via HuggingFace.",
  attribution: "SRTM 30m via HuggingFace",
  scheme: "xyz",
  formats: {
    ozt2: {
      url: "/api/dem-tile/{z}/{x}/{y}?format=ozt2",
      description: "OZT2 binary (gradient+Brotli), CesiumJS terrain",
      mime: "application/octet-stream",
    },
    png: {
      url: "/api/dem-tile/{z}/{x}/{y}?format=png",
      description: "Terrarium PNG, MapLibre raster-dem",
      mime: "image/png",
    },
  },
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
        status: 200,
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
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "no-cache",
        },
      },
    );
  }
}
