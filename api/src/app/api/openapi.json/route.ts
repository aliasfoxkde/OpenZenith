import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import spec from "./spec.json";

// The served document comes from `npm run openapi:generate`, which merges
// src/lib/openapi/base.json with the live route tree (scripts/gen-openapi.mjs).
// This route only serves it, substituting the deployment origin so the
// published `servers` entry always matches where the request landed.

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

export function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;
  return NextResponse.json(
    { ...spec, servers: [{ url: baseUrl, description: "Current deployment" }] },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
