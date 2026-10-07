import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { edgeGetJson, edgePutJson, apiCacheKey } from "@/lib/storage/edge-cache";

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

/** One NWS alert feature. Only the trimmed allowlist of properties is read. */
interface NwsAlertFeature {
  type?: unknown;
  geometry?: unknown;
  /** NWS always sends a properties object; missing keys read as undefined. */
  properties: Record<string, unknown>;
}

/** NWS active-alerts FeatureCollection. */
interface NwsAlertCollection {
  features?: NwsAlertFeature[];
}

export async function GET(_request: NextRequest) {
  // The cache read sits inside the try: a rejecting cache layer resolves to
  // the route's 200-error payload instead of escaping as an unhandled edge
  // 500. Matches earthquakes/route.ts.
  try {
    const cacheKey = apiCacheKey("weather-warnings");
    const cached = await edgeGetJson(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "X-Cache": "HIT", ...CORS_HEADERS, "Cache-Control": "public, max-age=60" },
      });
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
        { status: 502, headers: CORS_HEADERS },
      );
    }

    const data = (await resp.json()) as NwsAlertCollection;

    // Trim each feature to only display-relevant fields
    if (data.features) {
      data.features = data.features.map((f) => {
        const props = f.properties;
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

    edgePutJson(cacheKey, data, 120).catch(() => {});
    return NextResponse.json(data, {
      headers: { "X-Cache": "MISS", ...CORS_HEADERS, "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
