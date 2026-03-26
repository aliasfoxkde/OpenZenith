import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const ALLOWED_HOSTS = [
  "opensky-network.org",
  "api.adsbexchange.com",
  "www.adsbexchange.com",
  "services.arcgis.com",
  "services7.arcgis.com",
  "gis.fema.gov",
  "www.nhc.noaa.gov",
  "www.ncei.noaa.gov",
  "api.weather.gov",
  "earthquake.usgs.gov",
  "eonet.gsfc.nasa.gov",
  "celestrak.org",
  "api.rainviewer.com",
  "gibs.earthdata.nasa.gov",
  "marine-api.open-meteo.com",
  "api.open-meteo.com",
  "geocoding-api.open-meteo.com",
  "www.seismicportal.eu",
  "ring.nlnog.net",
  "api.ring.nlnog.net",
  "lg.ring.nlnog.net",
];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const targetUrl = segments.join("/");

  try {
    const parsed = new URL(targetUrl);
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return NextResponse.json(
        { error: "Domain not allowed" },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    parsed.search = url.search;
    const forwardUrl = parsed.toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch(forwardUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "OpenZenith/1.0",
        Accept: "application/json,*/*",
      },
    });

    clearTimeout(timeout);

    const data = await resp.arrayBuffer();
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Cache-Control", "public, max-age=30");
    headers.set("Content-Type", resp.headers.get("Content-Type") || "application/json");

    return new Response(data, { status: resp.status, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proxy error";
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
