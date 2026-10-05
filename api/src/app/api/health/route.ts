/**
 * API health and capability descriptor.
 *
 * GET /api/health - version, active storage backend (OZT2 primary and merged
 * fallback repos), DEM coverage envelope, and the canonical endpoint map.
 * Caching: Cache-Control: no-cache - this is a status probe, not a data read.
 */
import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import pkg from "../../../../package.json";

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

export function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? `oz-${Date.now().toString(36)}`;
  const backend = process.env.STORAGE_BACKEND || "huggingface";

  return NextResponse.json(
    {
      requestId,
      status: "healthy",
      version: pkg.version,
      storage: {
        backend,
        primary: "ozt2",
        ozt2_repo: "aliasfox/srtm30m-ozt2-v2",
        fallback_repo: "aliasfox/srtm30m-merged",
        chunkSize: "256x256",
      },
      coverage: {
        source: "SRTM 30m Global",
        resolution: "30 meters",
        latRange: [-56, 60],
        lonRange: [-180, 180],
      },
      endpoints: {
        elevation: "/api/elevation?lat={lat}&lon={lon}",
        tile: "/api/tile/{z}/{x}/{y}",
        health: "/api/health",
        docs: "/api/docs",
      },
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "no-cache",
      },
    },
  );
}
