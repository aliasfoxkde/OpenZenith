import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? `oz-${Date.now().toString(36)}`;
  const backend = process.env.STORAGE_BACKEND || "huggingface";
  const repo = process.env.HF_REPO || "aliasfox/srtm30m-chunks";

  return NextResponse.json(
    {
      requestId,
      status: "healthy",
      version: "0.8.0",
      storage: {
        backend,
        type: "chunks",
        repo: backend === "huggingface" ? repo : "configured",
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
