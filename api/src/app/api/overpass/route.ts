import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

/**
 * Proxy for Overpass API queries.
 * POST /api/overpass with body: { "query": "[out:json];node(48.85,2.35,48.86,2.36);out 1;" }
 */

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { query?: string };
    const query = body.query;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing query string" }, { status: 400, headers: CORS_HEADERS });
    }

    if (query.length > 10000) {
      return NextResponse.json({ error: "Query too long (max 10000 chars)" }, { status: 400, headers: CORS_HEADERS });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    clearTimeout(timeout);
    const data = await resp.json();

    const headers = new Headers(CORS_HEADERS);
    headers.set("Cache-Control", "public, max-age=60");
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Overpass proxy error";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
