import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/**
 * Marks this route for the Cloudflare Edge runtime, so its handlers execute
 * as Edge Workers rather than in the Node.js server runtime.
 */
export const runtime = "edge";

const ALLOWED_HOSTS = [
  "opensky-network.org",
  "api.adsbexchange.com",
  "www.adsbexchange.com",
  "services.arcgis.com",
  "services7.arcgis.com",
  "services9.arcgis.com",
  "api.overturemaps.org",
  "gis.fema.gov",
  "www.nhc.noaa.gov",
  "www.ncei.noaa.gov",
  "api.weather.gov",
  "earthquake.usgs.gov",
  "eonet.gsfc.nasa.gov",
  "celestrak.org",
  "api.rainviewer.com",
  "gibs.earthdata.nasa.gov",
  "map1.vis.earthdata.nasa.gov",
  "tilecache.rainviewer.com",
  "marine-api.open-meteo.com",
  "api.open-meteo.com",
  "geocoding-api.open-meteo.com",
  "www.seismicportal.eu",
  "ring.nlnog.net",
  "api.ring.nlnog.net",
  "lg.ring.nlnog.net",
  "unpkg.com",
  "aviationweather.gov",
];

/** Per-host Cache-Control max-age (seconds). Default: 30 */
const HOST_CACHE_TTL: Record<string, number> = {
  "earthquake.usgs.gov": 60,
  "eonet.gsfc.nasa.gov": 300,
  "celestrak.org": 600,
  "api.rainviewer.com": 120,
  "www.ncei.noaa.gov": 3600,
  "ring.nlnog.net": 3600,
  "api.ring.nlnog.net": 3600,
  "lg.ring.nlnog.net": 3600,
  "tilecache.rainviewer.com": 120,
};

/**
 * GET /api/proxy/{...path} — allow-listed CORS proxy for third-party data
 * feeds.
 *
 * The catch-all path segments are joined into the upstream URL, so
 * `/api/proxy/earthquake.usgs.gov/fdsnws/event/1/query` forwards to
 * `https://earthquake.usgs.gov/fdsnws/event/1/query`; the incoming query
 * string is carried over. Only the hostnames in `ALLOWED_HOSTS` may be
 * reached — anything else is a 403 — and the fetch runs under a 30-second
 * abort timeout. The upstream body and status are relayed verbatim with CORS
 * headers and a per-host `Cache-Control` max-age (30 seconds by default).
 * Responds 502 when the fetch throws.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const targetUrl = segments.join("/");

  try {
    const parsed = new URL(targetUrl);
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return NextResponse.json({ error: "Domain not allowed" }, { status: 403, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.search) parsed.search = url.search;
    const forwardUrl = parsed.toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 30000);
    // Clear the abort timer even when fetch rejects, so a failed request
    // doesn't leave a 30s live timer holding the controller.
    let resp: Response;
    try {
      resp = await fetch(forwardUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "OpenZenith/1.0",
          Accept: "application/json,*/*",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await resp.arrayBuffer();
    const headers = new Headers(CORS_HEADERS);
    const ttl = HOST_CACHE_TTL[parsed.hostname] ?? 30;
    headers.set("Cache-Control", `public, max-age=${ttl}`);
    headers.set("Content-Type", resp.headers.get("Content-Type") || "application/json");

    return new Response(data, { status: resp.status, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy error";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}

/**
 * CORS preflight for the generic proxy endpoint: answers OPTIONS with the
 * shared CORS headers and an empty body.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}
