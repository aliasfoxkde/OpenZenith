import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Proxy for ArcGIS REST API service discovery.
 * GET /api/arcgis?url=https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services?f=pjson
 */

const ALLOWED_HOSTS = [
  "services1.arcgis.com", "services2.arcgis.com", "services3.arcgis.com",
  "services4.arcgis.com", "services5.arcgis.com", "services6.arcgis.com",
  "services7.arcgis.com", "services8.arcgis.com", "services9.arcgis.com",
  "services10.arcgis.com", "services11.arcgis.com", "services12.arcgis.com",
  "services.arcgis.com", "gis.fema.gov", "gis.psu.edu",
  "services.nationalmap.gov", "opendata.arcgis.com",
  "www.arcgis.com", "terrain.arcgis.com", "elevation.arcgis.com",
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing ?url= parameter" }, { status: 400 });
  }

  try {
    const parsed = new URL(targetUrl);
    if (!ALLOWED_HOSTS.some((h) => parsed.hostname.endsWith(h))) {
      return NextResponse.json({ error: "Domain not allowed" }, { status: 403 });
    }

    // Forward with json format
    parsed.searchParams.set("f", "json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);
    const data = await resp.json();

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=300");
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ArcGIS proxy error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
