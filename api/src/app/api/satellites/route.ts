import { NextRequest, NextResponse } from "next/server";
import { cachedFetch } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

const CACHE_TTL_SATS = 300; // 5 minutes

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
 * Celestrak GP data can be very large (10k+ satellites for "active").
 * Edge workers have 30s CPU limits; large responses can time out.
 *
 * Strategy:
 * - Default to "space-station" (1 satellite) for fast loading
 * - Limit "active" group to first 500 entries to avoid timeout
 * - Use server-side cache so only first request hits upstream
 * - Return count so client knows data was truncated
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
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`;
    const resp = await cachedFetch(url, CACHE_TTL_SATS, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `Celestrak returned ${resp.status}` }, { status: 502, headers: CORS_HEADERS });
    }

    let data: unknown;
    try {
      const text = await resp.text();
      data = JSON.parse(text);
    } catch {
      // Celestrak sometimes returns text errors ("Invalid query: ...")
      return NextResponse.json(
        { count: 0, truncated: false, satellites: [], error: "Celestrak returned invalid response" },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    // Handle Celestrak text error responses that parsed as strings
    if (typeof data === "string" && data.includes("Invalid query")) {
      return NextResponse.json(
        { count: 0, truncated: false, satellites: [], error: data },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    // Large groups need truncation to avoid edge worker timeouts
    if (Array.isArray(data) && data.length > limit) {
      const truncated = data.slice(0, limit);
      const headers = new Headers({
        ...CORS_HEADERS,
        "Cache-Control": `public, max-age=${CACHE_TTL_SATS}`,
        "Content-Type": "application/json",
      });
      return new Response(
        JSON.stringify({
          count: data.length,
          truncated: true,
          limit,
          satellites: truncated,
        }),
        { status: 200, headers },
      );
    }

    return NextResponse.json(Array.isArray(data) ? { count: data.length, truncated: false, satellites: data } : data, {
      headers: { ...CORS_HEADERS, "Cache-Control": `public, max-age=${CACHE_TTL_SATS}` },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Satellite data fetch failed";
    // Return empty instead of 502 so the map doesn't break
    return NextResponse.json(
      { count: 0, truncated: false, satellites: [], error: message },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}
