import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

// Cache TTLs
const KP_CACHE_TTL = 300; // 5 minutes — SWPC updates every 5 min
const AURORA_CACHE_TTL = 600; // 10 minutes

const KP_URL = "https://services.swpc.noaa.gov/json/planetary-k-index-forecast.json";
const AURORA_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";

export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * GET /api/space-weather
 *
 * Returns:
 *   - kp_forecast: NOAA SWPC planetary K-index forecast
 *   - aurora: Ovation aurora probability coordinates
 *
 * Both are fetched from NOAA SWPC JSON APIs via the proxy. Each requested
 * source is fetched exactly once — "all" requests both in parallel.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "all"; // "kp" | "aurora" | "all"

  try {
    const headers = new Headers(CORS_HEADERS);
    const requestInit = { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "OpenZenith/1.0" } };

    if (type === "kp") {
      const kpResp = await fetch(KP_URL, requestInit);
      if (!kpResp.ok) {
        return NextResponse.json(
          { error: `SWPC Kp API returned ${kpResp.status}` },
          { status: 502, headers: CORS_HEADERS },
        );
      }
      headers.set("Cache-Control", `public, max-age=${KP_CACHE_TTL}`);
      // Relayed verbatim — `unknown` is the honest boundary type.
      const kp: unknown = await kpResp.json();
      return new Response(JSON.stringify(kp), { status: 200, headers });
    }

    if (type === "aurora") {
      const auroraResp = await fetch(AURORA_URL, requestInit);
      if (!auroraResp.ok) {
        return NextResponse.json(
          { error: `SWPC Aurora API returned ${auroraResp.status}` },
          { status: 502, headers: CORS_HEADERS },
        );
      }
      headers.set("Cache-Control", `public, max-age=${AURORA_CACHE_TTL}`);
      const aurora: unknown = await auroraResp.json();
      return new Response(JSON.stringify(aurora), { status: 200, headers });
    }

    // type === "all" (default) — tolerate a single source failing, but say
    // which one: an empty stand-in alone is indistinguishable from "no data".
    const [kpResp, auroraResp] = await Promise.all([fetch(KP_URL, requestInit), fetch(AURORA_URL, requestInit)]);

    if (!kpResp.ok && !auroraResp.ok) {
      return NextResponse.json({ error: "Both SWPC APIs unavailable" }, { status: 502, headers: CORS_HEADERS });
    }

    headers.set("Cache-Control", `public, max-age=${Math.min(KP_CACHE_TTL, AURORA_CACHE_TTL)}`);
    headers.set("Content-Type", "application/json");

    // Same read order as before: Kp first, then aurora.
    const kp: unknown = kpResp.ok ? await kpResp.json() : [];
    const aurora: unknown = auroraResp.ok ? await auroraResp.json() : { coordinates: [] };
    const errors = [
      ...(kpResp.ok ? [] : [`kp: SWPC Kp API returned ${kpResp.status}`]),
      ...(auroraResp.ok ? [] : [`aurora: SWPC Aurora API returned ${auroraResp.status}`]),
    ];

    return new Response(JSON.stringify({ kp_forecast: kp, aurora, ...(errors.length ? { errors } : {}) }), {
      status: 200,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Space weather fetch failed";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
