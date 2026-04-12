import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS } from "@/lib/cors";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const url = new URL("https://opensky-network.org/api/states/all");
  if (searchParams.has("bbox")) {
    url.searchParams.set("bbox", searchParams.get("bbox")!);
  }
  if (searchParams.has("lamin")) {
    url.searchParams.set("lamin", searchParams.get("lamin")!);
    url.searchParams.set("lamax", searchParams.get("lamax")!);
    url.searchParams.set("lomin", searchParams.get("lomin")!);
    url.searchParams.set("lomax", searchParams.get("lomax")!);
  }

  try {
    const resp = await cachedFetch(url.toString(), CACHE_TTL.FLIGHTS, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json" },
    });

    const data = await resp.json();

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=15");
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Flight data fetch failed";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
