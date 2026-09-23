import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { r2GetJson, r2PutJson, apiCacheKey } from "@/lib/storage/r2-json-cache";

export const runtime = "edge";

// Preflight has nothing to await — stays promise-returning because callers await handlers.
export function OPTIONS() {
  return Promise.resolve(corsPreflightResponse());
}

/**
 * Weather warnings from NOAA/NWS.
 *
 * Trims verbose fields (description, parameters, instruction) to reduce
 * response from ~1.7MB to ~100KB while retaining all display-relevant data.
 */
export async function GET(_request: NextRequest) {
  // The cache read sits inside the try: a rejecting cache layer resolves to
  // the route's 200-error payload instead of escaping as an unhandled edge
  // 500. Matches earthquakes/route.ts.
  try {
    const cacheKey = apiCacheKey("weather-warnings");
    const cached = await r2GetJson(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { headers: { "X-Cache": "HIT", ...CORS_HEADERS } });
    }

    const resp = await fetch("https://api.weather.gov/alerts/active", {
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/json,*/*",
        "User-Agent": "OpenZenith/1.0",
      },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Weather API returned ${resp.status}` },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    const data = await resp.json();

    // Trim each feature to only display-relevant fields
    if (data.features) {
      data.features = data.features.map((f: Record<string, unknown>) => {
        const props = f.properties as Record<string, unknown>;
        return {
          type: f.type,
          geometry: f.geometry,
          properties: {
            event: props.event,
            severity: props.severity,
            urgency: props.urgency,
            headline: props.headline,
            areaDesc: props.areaDesc,
            effective: props.effective,
            expires: props.expires,
            onset: props.onset,
            ends: props.ends,
            senderName: props.senderName,
            status: props.status,
            category: props.category,
            id: props.id,
          },
        };
      });
    }

    r2PutJson(cacheKey, data, 120).catch(() => {});
    return NextResponse.json(data, { headers: { "X-Cache": "MISS", ...CORS_HEADERS } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
