import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

// Cache TTLs
const KP_CACHE_TTL = 300; // 5 minutes — SWPC updates every 5 min
const AURORA_CACHE_TTL = 600; // 10 minutes

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * GET /api/space-weather
 *
 * Returns:
 *   - kp_forecast: NOAA SWPC planetary K-index forecast
 *   - aurora: Ovation aurora probability coordinates
 *
 * Both are fetched from NOAA SWPC JSON APIs via the proxy.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "all"; // "kp" | "aurora" | "all"

  try {
    const headers = new Headers(CORS_HEADERS);

    if (type === "kp" || type === "all") {
      // Fetch Kp index forecast
      const kpResp = await fetch(
        `https://services.swpc.noaa.gov/json/planetary-k-index-forecast.json`,
        { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "OpenZenith/1.0" } },
      );

      if (!kpResp.ok) {
        return NextResponse.json(
          { error: `SWPC Kp API returned ${kpResp.status}` },
          { status: 200, headers: CORS_HEADERS },
        );
      }

      const kpData = await kpResp.json();

      if (type === "kp") {
        headers.set("Cache-Control", `public, max-age=${KP_CACHE_TTL}`);
        return new Response(JSON.stringify(kpData), { status: 200, headers });
      }
    }

    if (type === "aurora" || type === "all") {
      // Fetch aurora forecast
      const auroraResp = await fetch(
        `https://services.swpc.noaa.gov/json/ovation_aurora_latest.json`,
        { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "OpenZenith/1.0" } },
      );

      if (!auroraResp.ok) {
        return NextResponse.json(
          { error: `SWPC Aurora API returned ${auroraResp.status}` },
          { status: 200, headers: CORS_HEADERS },
        );
      }

      const auroraData = await auroraResp.json();

      if (type === "aurora") {
        headers.set("Cache-Control", `public, max-age=${AURORA_CACHE_TTL}`);
        return new Response(JSON.stringify(auroraData), { status: 200, headers });
      }
    }

    // type === "all" — fetch both sequentially
    const [kpResp, auroraResp] = await Promise.all([
      fetch(`https://services.swpc.noaa.gov/json/planetary-k-index-forecast.json`, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "OpenZenith/1.0" },
      }),
      fetch(`https://services.swpc.noaa.gov/json/ovation_aurora_latest.json`, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "OpenZenith/1.0" },
      }),
    ]);

    const kpOk = kpResp.ok;
    const auroraOk = auroraResp.ok;

    if (!kpOk && !auroraOk) {
      return NextResponse.json(
        { error: "Both SWPC APIs unavailable" },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    const kpData = kpOk ? await kpResp.json() : [];
    const auroraData = auroraOk ? await auroraResp.json() : { coordinates: [] };

    const minTtl = Math.min(KP_CACHE_TTL, AURORA_CACHE_TTL);
    headers.set("Cache-Control", `public, max-age=${minTtl}`);
    headers.set("Content-Type", "application/json");

    return new Response(
      JSON.stringify({
        kp_forecast: kpData,
        aurora: auroraData,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Space weather fetch failed";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
