import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

/**
 * DEM terrain provider metadata + health endpoint.
 *
 * GET /api/dem-tile — TileJSON metadata for CesiumJS/MapLibre
 * GET /api/dem-tile?health=1 — Tile coverage health check (counts per zoom)
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
  maxzoom: 10,  // z0-8 (~1.7km) + z10 (~156m)
  bounds: [-180, -90, 180, 90],
  center: [0, 0, 4],
  encoding: "terrarium" as const,
  format: "terrarium",
  tileFormat: "terrarium",
  available: true,
  version: "1.0.0",
  name: "OpenZenith Global DEM",
  description: "Multi-resolution terrain: z0-8 (~1.7km) + z10 (~156m). Copernicus GLO-30 + GEBCO 2025.",
  attribution: "Copernicus DEM, GEBCO 2025",
  scheme: "xyz",
};

const EXPECTED_TILES: Record<number, number> = {
  0: 1,
  1: 4,
  2: 16,
  3: 64,
  4: 256,
  5: 1024,
  6: 4096,
  7: 16384,
  8: 65536,
  10: 1046700,
};

export async function GET(request: NextRequest) {
  // Health check mode
  if (request.nextUrl.searchParams.get("health") === "1") {
    return handleHealthCheck();
  }

  return NextResponse.json(TERRAIN_METADATA, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  });
}

async function handleHealthCheck() {
  try {
    const { env } = getRequestContext();
    const bucket = (env as Record<string, unknown>).DEM_TILES as R2Bucket | undefined;

    if (!bucket) {
      return NextResponse.json(
        { status: "error", error: "R2 bucket not bound" },
        { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const zoomCounts: Record<string, { found: number; expected: number }> = {};
    let totalFound = 0;
    let totalExpected = 0;

    for (const [z, expected] of Object.entries(EXPECTED_TILES)) {
      const prefix = `tiles/${z}/`;
      let found = 0;
      let cursor: string | undefined;

      // Count objects with this prefix using R2 list (max 1000 per call)
      do {
        const listed = await bucket.list({ prefix, cursor, limit: 1000 });
        found += listed.objects.length;
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);

      zoomCounts[z] = { found, expected };
      totalFound += found;
      totalExpected += expected;
    }

    const allComplete = Object.values(zoomCounts).every(
      (v) => v.found >= v.expected,
    );

    return NextResponse.json(
      {
        status: allComplete ? "ok" : "incomplete",
        total_tiles: totalFound,
        total_expected: totalExpected,
        coverage_percent: Math.round((totalFound / totalExpected) * 100),
        zooms: zoomCounts,
      },
      {
        headers: {
          "Cache-Control": "no-cache",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (error) {
    console.error("DEM tile health check failed:", error);
    return NextResponse.json(
      { status: "error", error: "Health check failed" },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}

interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<R2ListResult>;
}

interface R2Object {
  body: ReadableStream;
  size: number;
  etag: string;
}

interface R2ListResult {
  objects: Array<{ key: string; size: number; etag: string }>;
  truncated: boolean;
  cursor?: string;
}
