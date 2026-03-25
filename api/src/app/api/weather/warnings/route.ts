import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const ARCGIS_URL =
  "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/NWS_Watch_Warn_Advisory/FeatureServer/0/query";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const url = new URL(ARCGIS_URL);
  url.searchParams.set("f", "geojson");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("resultRecordCount", "500");
  if (searchParams.has("geometry")) {
    url.searchParams.set("geometry", searchParams.get("geometry")!);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    const data = await resp.json();

    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=120");
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Weather warnings fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
