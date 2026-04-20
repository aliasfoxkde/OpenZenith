import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, staleWhileRevalidate } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { r2GetJson, r2PutJson, apiCacheKey } from "@/lib/storage/r2-json-cache";

export const runtime = "edge";

const CACHE_TTL_SATS = 600; // 10 minutes — Celestrak is slow from CF edge
const STALE_TTL_SATS = 1800; // 30 minutes stale-while-revalidate window

const VALID_GROUPS = new Set([
  "stations",
  "active",
  "visual",
  "weather",
  "military",
  "science",
  "communication",
  "navigation",
  "gnss",
  "resource",
  "radar",
  "cubesats",
  "education",
  "amateur",
  "engineering",
  "geodetic",
  "disaster",
  "earth-observation",
  "maritime",
  "positioning",
  "experiment",
  "brasil",
  "china",
  "eur-metop",
  "glo-iridium",
  "iridium",
  "iridium-NEXT",
  "musson",
  "orbcomm",
  "sarsat",
  "spire",
  "starlink",
  "swarm",
  "globalstar",
  "oneweb",
  "other-comm",
]);

/**
 * Celestrak GP data — satellite TLE/JSON elements.
 *
 * Cloudflare edge workers have poor egress to celestrak.org (~10-15s).
 * Strategy:
 * - Default to "stations" (ISS + crewed vehicles, ~30 entries, small response)
 * - Truncate "active" group to 500 entries (would be ~50MB otherwise)
 * - 10-minute server cache so only first request per cache window is slow
 * - 15s fetch timeout (Celestrak needs ~10-12s from CF edge)
 * - Handle text error responses gracefully
 */

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const group = searchParams.get("group") || "stations";
  const limit = Math.min(Number(searchParams.get("limit")) || 500, 2000);

  if (!VALID_GROUPS.has(group)) {
    return NextResponse.json(
      { error: `Invalid group. Common: ${[...VALID_GROUPS].slice(0, 10).join(", ")}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    // Try R2 cache first (Celestrak is 8-15s from CF edge)
    const cacheKey = apiCacheKey("satellites", { group, limit: String(limit) });
    const cached = await r2GetJson(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { ...CORS_HEADERS, "Cache-Control": `public, max-age=${CACHE_TTL_SATS}`, "X-Cache": "HIT" },
      });
    }

    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`;
    const resp = await staleWhileRevalidate(url, CACHE_TTL_SATS, STALE_TTL_SATS, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { count: 0, truncated: false, satellites: [], error: `Celestrak returned ${resp.status}` },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    let data: unknown;
    try {
      const text = await resp.text();
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { count: 0, truncated: false, satellites: [], error: "Celestrak returned invalid response" },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    if (typeof data === "string" && data.includes("Invalid query")) {
      return NextResponse.json(
        { count: 0, truncated: false, satellites: [], error: data },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    if (Array.isArray(data) && data.length > limit) {
      const truncated = data.slice(0, limit);
      const result = { count: data.length, truncated: true, limit, satellites: truncated };
      r2PutJson(cacheKey, result, CACHE_TTL_SATS).catch(() => {});
      return NextResponse.json(result, {
        headers: { ...CORS_HEADERS, "Cache-Control": `public, max-age=${CACHE_TTL_SATS}`, "X-Cache": "MISS" },
      });
    }

    const result = Array.isArray(data) ? { count: data.length, truncated: false, satellites: data } : data;
    r2PutJson(cacheKey, result, CACHE_TTL_SATS).catch(() => {});
    return NextResponse.json(result, {
      headers: { ...CORS_HEADERS, "Cache-Control": `public, max-age=${CACHE_TTL_SATS}`, "X-Cache": "MISS" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Satellite data fetch failed";
    return NextResponse.json(
      { count: 0, truncated: false, satellites: [], error: message },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}
