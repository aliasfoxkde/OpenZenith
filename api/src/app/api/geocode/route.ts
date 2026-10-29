/**
 * Forward geocoding proxy.
 *
 * GET /api/geocode?query=<text> - relays to Nominatim /search and returns
 * { requestId, results, count } with display name, lat/lon and address parts.
 * Caching: Workers Cache API for 300s (Nominatim etiquette caps how hard the
 * upstream may be leaned on); responses set
 * Cache-Control: public, max-age=3600 and an X-Cache: HIT|MISS marker.
 */
import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { edgeGetJson, edgePutJson } from "@/lib/storage/edge-cache";

/** Marks the route for the Cloudflare edge runtime (Workers) instead of the Node.js server runtime. */
export const runtime = "edge";

// Short TTL: nominatim etiquette caps how aggressively we may lean on the
// upstream service, and the edge cache is exactly the repeated-query shield.
const GEOCODE_EDGE_TTL_SECONDS = 300;

// Preflight has nothing to await — stays promise-returning because callers await handlers.
/**
 * CORS preflight handler for the geocoding endpoint: answers the browser's
 * OPTIONS probe with the allowed-origin headers and an empty body.
 */
export function OPTIONS() {
  return Promise.resolve(corsPreflightResponse());
}

/**
 * GET handler for forward geocoding.
 *
 * Reads the required `query` parameter — a place name, rejected when empty
 * or longer than 200 characters with 400 — plus an optional `limit` (default
 * 5, clamped to 1..10). The query is relayed to the Nominatim `/search`
 * endpoint with `addressdetails=1` and a 10-second timeout, and each hit is
 * reduced to its display name, numeric lat/lon, type, importance and address
 * parts.
 *
 * Only the results array is edge-cached (300 s TTL, keyed by lower-cased
 * query and limit) so the per-request `requestId` is never replayed from
 * another caller's lookup. A Nominatim 429 becomes 429 with a `Retry-After`
 * header, other upstream failures become 502.
 */
export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? `oz-${Date.now().toString(36)}`;
  const query = request.nextUrl.searchParams.get("query")?.trim();
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.floor(requestedLimit), 10)) : 5;

  if (!query || query.length > 200) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INVALID_PARAM", message: "Missing or invalid parameter: query" },
        requestId,
        results: [],
        count: 0,
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    // Edge Cache API in front of nominatim: identical place-name queries
    // repeat constantly (autocomplete retyping, shared popular searches) and
    // worker responses are not CDN-cached on Pages. Only the results array is
    // cached — the envelope's requestId is per-request correlation and must
    // not be replayed from another caller's lookup.
    const cacheKey = `api/geocode?q=${encodeURIComponent(query.toLowerCase())}&limit=${limit}`;
    const cached = await edgeGetJson<{ results: Record<string, unknown>[]; count: number }>(cacheKey);
    if (cached) {
      return NextResponse.json(
        { requestId, results: cached.results, count: cached.count },
        { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600", "X-Cache": "HIT" } },
      );
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "OpenZenith/1.0 (geospatial platform)" },
    });

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after") ?? "5";
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "GEOCODE_RATE_LIMITED",
            message: "Rate limit exceeded. Slow down requests.",
            retryable: true,
            retryAfter: Number(retryAfter),
          },
          requestId,
          results: [],
          count: 0,
        },
        { status: 429, headers: { ...CORS_HEADERS, "Retry-After": retryAfter } },
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "GEOCODE_UPSTREAM", message: "Upstream geocoding service unavailable", retryable: true },
          requestId,
          results: [],
          count: 0,
        },
        { status: 502, headers: CORS_HEADERS },
      );
    }

    const data = (await res.json()) as Record<string, unknown>[];
    const results = data.map((r) => ({
      display_name: r["display_name"],
      lat: Number(r["lat"]),
      lon: Number(r["lon"]),
      type: r["type"],
      importance: r["importance"],
      address: r["address"],
    }));
    await edgePutJson(cacheKey, { results, count: results.length }, GEOCODE_EDGE_TTL_SECONDS);

    return NextResponse.json(
      {
        requestId,
        results,
        count: results.length,
      },
      { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600", "X-Cache": "MISS" } },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "GEOCODE_UNAVAILABLE", message: "Geocoding request failed", retryable: true },
        requestId,
        results: [],
        count: 0,
      },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}
