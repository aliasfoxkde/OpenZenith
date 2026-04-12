import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsError, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

function parseBboxParam(val: string | null, min: number, max: number): number | null {
  if (!val) return null;
  const n = Number(val);
  return isNaN(n) || n < min || n > max ? null : n;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate individual bbox params if provided
  const lamin = parseBboxParam(searchParams.get("lamin"), -90, 90);
  const lamax = parseBboxParam(searchParams.get("lamax"), -90, 90);
  const lomin = parseBboxParam(searchParams.get("lomin"), -180, 180);
  const lomax = parseBboxParam(searchParams.get("lomax"), -180, 180);

  // If any bbox param was provided, all four must be valid
  const hasAny = [lamin, lamax, lomin, lomax].some((v) => v !== null);
  const allValid = lamin !== null && lamax !== null && lomin !== null && lomax !== null;
  if (hasAny && !allValid) {
    return corsError("Invalid bbox params: lamin, lamax (-90 to 90), lomin, lomax (-180 to 180) required", 400);
  }

  const url = new URL("https://opensky-network.org/api/states/all");
  if (searchParams.has("bbox")) {
    url.searchParams.set("bbox", searchParams.get("bbox")!);
  }
  if (allValid) {
    url.searchParams.set("lamin", String(lamin));
    url.searchParams.set("lamax", String(lamax));
    url.searchParams.set("lomin", String(lomin));
    url.searchParams.set("lomax", String(lomax));
  }

  try {
    const resp = await cachedFetch(url.toString(), CACHE_TTL.FLIGHTS, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      return corsError(`OpenSky API returned ${resp.status}`, 502);
    }

    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      return corsError("Invalid JSON from upstream", 502);
    }

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

