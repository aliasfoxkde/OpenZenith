import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Waterways endpoint — proxies to Overpass API for water features.
 *
 * Parameters:
 *   bbox - Bounding box as "minLon,minLat,maxLon,maxLat"
 *   type  - Feature type: "rivers", "lakes", or "all" (default: "all")
 *   limit - Max features to return (default: 100, max: 500)
 */
export async function GET(request: NextRequest) {
  const bbox = request.nextUrl.searchParams.get("bbox");
  const type = request.nextUrl.searchParams.get("type") || "all";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 100, 500);

  if (!bbox) {
    return NextResponse.json(
      { error: "Missing required parameter: bbox (format: minLon,minLat,maxLon,maxLat)" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    return NextResponse.json(
      { error: "Invalid bbox format. Use: minLon,minLat,maxLon,maxLat" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const [minLon, minLat, maxLon, maxLat] = parts;

  if (Math.abs(maxLon - minLon) > 10 || Math.abs(maxLat - minLat) > 10) {
    return NextResponse.json(
      { error: "Bounding box too large. Max 10 degrees in each dimension." },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Build Overpass QL query based on type. "all" is a UNION of the rivers and
  // lakes filters: the previous single filter
  // (["waterway"~...]["natural"="water"]) demanded both tags on one element —
  // a combination almost nothing in OSM carries — so the documented default
  // returned an empty FeatureCollection everywhere.
  const bboxClause = `(${minLat},${minLon},${maxLat},${maxLon})`;
  const RIVERS = '["waterway"~"river|stream|canal"]';
  const LAKES = '["natural"="water"]["water"!="river"]';
  const filters = type === "rivers" ? [RIVERS] : type === "lakes" ? [LAKES] : [RIVERS, LAKES];
  const union = filters
    .map((f) => `way${f}${bboxClause};\n  relation${f}${bboxClause};`)
    .join("\n  ");

  const query = `
    [out:json][timeout:25];
    (
      ${union}
    );
    out body geom;
    >;
    out skel qt;
  `;

  try {
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const res = await cachedFetch(overpassUrl, CACHE_TTL.WATERWAYS, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Overpass API unavailable" }, { status: 200, headers: CORS_HEADERS });
    }

    // `out body geom` makes Overpass attach per-way geometry as
    // {lat, lon} objects — without it, ways carry only a node-id list and
    // this endpoint could never emit a feature.
    const data = (await res.json()) as {
      elements?: Array<{
        type: string;
        geometry?: Array<{ lat: number; lon: number }>;
        id: number;
        tags?: Record<string, string>;
      }>;
    };

    // Convert to GeoJSON FeatureCollection
    const features: Array<Record<string, unknown>> = [];
    const elements = Array.isArray(data.elements) ? data.elements : [];

    for (const el of elements) {
      if (features.length >= limit) break;

      if (el.type === "way" && el.geometry) {
        // Overpass geometry is {lat, lon}; GeoJSON wants [lon, lat].
        const coords = el.geometry.map((c) => [c.lon, c.lat]);
        if (coords.length < 2) continue;

        const isPolygon = el.tags?.natural === "water" && coords.length >= 3;
        const isClosed = coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1];

        features.push({
          type: "Feature",
          geometry: {
            type: isClosed || isPolygon ? "Polygon" : "LineString",
            coordinates: isClosed || isPolygon ? [coords] : coords,
          },
          properties: {
            id: el.id,
            name: el.tags?.name || null,
            waterway: el.tags?.waterway || null,
            natural: el.tags?.natural || null,
            water: el.tags?.water || null,
          },
        });
      }
    }

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        count: features.length,
      },
      { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=604800" } },
    );
  } catch {
    return NextResponse.json({ error: "Waterways query failed" }, { status: 200, headers: CORS_HEADERS });
  }
}
