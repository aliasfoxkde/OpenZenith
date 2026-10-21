import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/** Marks the route for the Cloudflare edge runtime (Workers) instead of the Node.js server runtime. */
export const runtime = "edge";

/**
 * Proxy for ArcGIS REST API service discovery.
 * GET /api/arcgis?url=https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services?f=pjson
 */

const ALLOWED_HOSTS = [
  "services1.arcgis.com",
  "services2.arcgis.com",
  "services3.arcgis.com",
  "services4.arcgis.com",
  "services5.arcgis.com",
  "services6.arcgis.com",
  "services7.arcgis.com",
  "services8.arcgis.com",
  "services9.arcgis.com",
  "services10.arcgis.com",
  "services11.arcgis.com",
  "services12.arcgis.com",
  "services.arcgis.com",
  "gis.fema.gov",
  "gis.psu.edu",
  "services.nationalmap.gov",
  "opendata.arcgis.com",
  "www.arcgis.com",
  "terrain.arcgis.com",
  "elevation.arcgis.com",
];

/**
 * GET handler that proxies ArcGIS REST service discovery.
 *
 * Reads the required `url` query parameter (400 when absent), parses it and
 * rejects any host that is not on the ArcGIS allowlist — matched on an exact
 * hostname or a subdomain boundary, so `evil-services9.arcgis.com` cannot slip
 * through. The forwarded request forces `f=json` and aborts after 15 seconds.
 *
 * The upstream service document is relayed verbatim as JSON with a 300-second
 * public cache; a non-OK upstream status becomes 502 and a thrown error becomes 502.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing ?url= parameter" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const parsed = new URL(targetUrl);
    // Exact match or a subdomain boundary — a bare endsWith would admit
    // attacker-controlled hosts like evil-services9.arcgis.com.
    if (!ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
      return NextResponse.json({ error: "Domain not allowed" }, { status: 403, headers: CORS_HEADERS });
    }

    // Forward with json format
    parsed.searchParams.set("f", "json");

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 15000);

    const resp = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);
    if (!resp.ok) {
      // An upstream error document must not be relayed as a green 200.
      return NextResponse.json(
        { error: `ArcGIS service returned ${resp.status}` },
        { status: 502, headers: CORS_HEADERS },
      );
    }
    // ArcGIS service document is relayed verbatim — `unknown` is honest here.
    const data: unknown = await resp.json();

    const headers = new Headers(CORS_HEADERS);
    headers.set("Cache-Control", "public, max-age=300");
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ArcGIS proxy error";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}

/**
 * CORS preflight handler for the ArcGIS proxy: answers the browser's OPTIONS
 * probe with the allowed-origin headers and an empty body.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}
