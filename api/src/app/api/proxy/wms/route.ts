import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * WMS proxy endpoint.
 *
 * Proxies WMS GetMap requests to external WMS servers,
 * adding CORS headers and handling common parameters.
 *
 * Usage: GET /api/proxy/wms?url=<encoded_wms_url>&layers=<layers>&...
 */

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

const ALLOWED_PARAMS = new Set([
  "service", "version", "request", "layers", "styles", "srs", "crs",
  "bbox", "width", "height", "format", "transparent", "bgcolor",
  "exceptions", "time", "elevation", "featureid", "filter",
  "cql_filter", "buffer", "dpi", "map_resolution", "format_options",
  "sld", "sld_body", "legend_options",
]);

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: "Missing 'url' parameter" },
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  // Validate URL scheme
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json(
      { error: "Invalid URL" },
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return NextResponse.json(
      { error: "Only HTTP/HTTPS URLs allowed" },
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

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
    return NextResponse.json(
      { error: "Missing 'layers' parameter" },
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
  if (!proxyParams.has("BBOX")) {
    return NextResponse.json(
      { error: "Missing 'bbox' parameter" },
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
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
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!response.ok) {
      return new Response(`WMS error: ${response.status}`, {
        status: response.status,
        headers: CORS_HEADERS,
      });
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
    return NextResponse.json(
      { error: "Failed to fetch from WMS server" },
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
}
