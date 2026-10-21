import { NextRequest } from "next/server";
import { CORS_HEADERS, corsError, corsPreflightResponse } from "@/lib/cors";
import { BASEMAP_TILE_HOSTS } from "@/lib/basemaps";

/**
 * Marks this route for the Cloudflare Edge runtime, so its handlers execute
 * as Edge Workers rather than in the Node.js server runtime.
 */
export const runtime = "edge";

/**
 * WMS proxy endpoint.
 *
 * Proxies WMS GetMap requests to external WMS servers,
 * adding CORS headers and handling common parameters.
 *
 * Usage: GET /api/proxy/wms?url=<encoded_wms_url>&layers=<layers>&...
 */

/** Hostnames allowed for WMS proxy requests. Registry basemaps derive their
 * hosts automatically — add non-basemap WMS sources below. */
const ALLOWED_WMS_HOSTS = [
  "gibs.earthdata.nasa.gov",
  "map1.vis.earthdata.nasa.gov",
  "services.arcgis.com",
  "services7.arcgis.com",
  "gis.fema.gov",
  ...BASEMAP_TILE_HOSTS,
  "demo.mapserver.org",
  "example.com",
];

/**
 * CORS preflight for the WMS proxy endpoint: answers OPTIONS with the shared
 * CORS headers and an empty body.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}

const ALLOWED_PARAMS = new Set([
  "service",
  "version",
  "request",
  "layers",
  "styles",
  "srs",
  "crs",
  "bbox",
  "width",
  "height",
  "format",
  "transparent",
  "bgcolor",
  "exceptions",
  "time",
  "elevation",
  "featureid",
  "filter",
  "cql_filter",
  "buffer",
  "dpi",
  "map_resolution",
  "format_options",
  "sld",
  "sld_body",
  "legend_options",
]);

/**
 * GET /api/proxy/wms — issues a WMS `GetMap` request through the proxy so
 * the map can read external WMS layers without CORS violations.
 *
 * Query parameters: `url` (the WMS server base URL), plus the WMS
 * parameters themselves. `layers` and `bbox` are mandatory (400 otherwise);
 * `width`/`height` default to 256×256 and `format` to `image/png`. Only
 * parameters on the WMS allow-list are forwarded, `version` defaults to
 * `1.3.0`, and `SERVICE=WMS`/`REQUEST=GetMap`/`TRANSPARENT=TRUE` are always
 * applied. The target host must be on the WMS allow-list (403 otherwise) and
 * the scheme must be HTTP or HTTPS (400 otherwise). Responds 200 with the
 * upstream image and `Cache-Control: public, max-age=3600`; upstream failures
 * are relayed with the upstream status, and a thrown fetch is a 502.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return corsError("Missing 'url' parameter", 400);
  }

  // Validate URL scheme
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return corsError("Invalid URL", 400);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return corsError("Only HTTP/HTTPS URLs allowed", 400);
  }

  if (!ALLOWED_WMS_HOSTS.includes(parsedUrl.hostname)) {
    return corsError("Domain not allowed", 403);
  }

  // A fragment would swallow every appended WMS parameter (#x?A=B is all
  // fragment), so strip it before composing the proxy URL.
  parsedUrl.hash = "";

  // Build proxy URL with allowed params
  const proxyParams = new URLSearchParams();
  proxyParams.set("SERVICE", "WMS");
  proxyParams.set("VERSION", request.nextUrl.searchParams.get("version") || "1.3.0");
  proxyParams.set("REQUEST", "GetMap");

  // Pass through allowed WMS params
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key === "url") continue;
    const lower = key.toLowerCase();
    if (ALLOWED_PARAMS.has(lower)) {
      proxyParams.set(key.toUpperCase(), value);
    }
  }

  // Ensure required params
  if (!proxyParams.has("LAYERS")) {
    return corsError("Missing 'layers' parameter", 400);
  }
  if (!proxyParams.has("BBOX")) {
    return corsError("Missing 'bbox' parameter", 400);
  }
  if (!proxyParams.has("WIDTH") || !proxyParams.has("HEIGHT")) {
    proxyParams.set("WIDTH", "256");
    proxyParams.set("HEIGHT", "256");
  }
  if (!proxyParams.has("FORMAT")) {
    proxyParams.set("FORMAT", "image/png");
  }
  proxyParams.set("TRANSPARENT", "TRUE");

  const separator = parsedUrl.search ? "&" : "?";
  const proxyUrl = `${parsedUrl.toString()}${separator}${proxyParams.toString()}`;

  try {
    const response = await fetch(proxyUrl, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!response.ok) {
      return corsError(`WMS error: ${response.status}`, response.status);
    }

    const contentType = response.headers.get("Content-Type") || "image/png";
    const body = response.body;

    return new Response(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("WMS proxy error:", error);
    return corsError("Failed to fetch from WMS server", 502);
  }
}
