import { NextResponse } from "next/server";

export const runtime = "edge";

const FIRMS_KEY = process.env.NEXT_PUBLIC_FIRMS_API_KEY || "";

export async function GET() {
  try {
    if (!FIRMS_KEY) {
      return NextResponse.json(
        { type: "FeatureCollection", features: [], error: "FIRMS_API_KEY not configured" },
        { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
      );
    }

    const bbox = "-180,-90,180,90";
    const day = new Date().toISOString().slice(0, 10);
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_KEY}/VIIRS_SNPP_NRT/${bbox}/${day}`;

    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { type: "FeatureCollection", features: [], error: `FIRMS API returned ${resp.status}` },
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const csv = await resp.text();
    const lines = csv.trim().split("\n");

    if (lines.length < 2) {
      return NextResponse.json(
        { type: "FeatureCollection", features: [], count: 0 },
        { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } },
      );
    }

    const features: any[] = [];
    const maxFeatures = 2000;

    for (let i = 1; i < lines.length && i <= maxFeatures; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 10) continue;

      const lat = parseFloat(cols[0]);
      const lon = parseFloat(cols[1]);
      const brightness = parseFloat(cols[2]) || 0;
      const confidence = parseFloat(cols[9]);
      const frp = parseFloat(cols[13]) || 0;
      const daynight = (cols[14] || "D").trim();

      if (isNaN(lat) || isNaN(lon)) continue;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: { confidence, brightness, frp, daynight, satellite: "VIIRS_SNPP" },
      });
    }

    return NextResponse.json(
      { type: "FeatureCollection", features, count: features.length },
      { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch FIRMS data";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
