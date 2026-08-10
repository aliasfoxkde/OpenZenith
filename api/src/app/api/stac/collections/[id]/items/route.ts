/**
 * STAC Items endpoint — returns GeoJSON FeatureCollection for a collection.
 *
 * /api/stac/collections/{id}/items
 *
 * Supports bbox and limit query params.
 */

import { NextRequest, NextResponse } from "next/server";
import { cachedFetch } from "@/lib/cache";
import { CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

// Map STAC collection IDs to their data source URLs
const STAC_COLLECTION_SOURCES: Record<string, { url: string; cacheTtl: number }> = {
  earthquakes: {
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    cacheTtl: CACHE_TTL.EARTHQUAKES,
  },
  flights: {
    url: "https://opensky-network.org/api/states/all",
    cacheTtl: CACHE_TTL.FLIGHTS,
  },
  vessels: {
    url: "https://api.marinetraffic.com/export/vessels",
    cacheTtl: CACHE_TTL.VESSELS,
  },
  weather: {
    url: "https://api.open-meteo.com/v1/forecast",
    cacheTtl: CACHE_TTL.RADAR,
  },
};

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = STAC_COLLECTION_SOURCES[id];

  if (!source) {
    return NextResponse.json(
      { error: `Collection '${id}' not found` },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(1000, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10)));
  const bboxParam = searchParams.get("bbox");

  try {
    const resp = await cachedFetch(source.url, source.cacheTtl, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${resp.status}` },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    const data = await resp.json() as {
      type?: string;
      features?: GeoJSON.Feature[];
      geometries?: unknown[];
    };

    let features: GeoJSON.Feature[] = [];

    if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
      features = data.features;
    } else if (Array.isArray(data?.geometries)) {
      // Some APIs return { geometries: [...] } format
      features = (data.geometries as GeoJSON.Geometry[]).map((geom, i) => ({
        type: "Feature" as const,
        geometry: geom,
        properties: {},
        id: i,
      }));
    }

    // Apply bbox filter if provided
    if (bboxParam) {
      const [west, south, east, north] = bboxParam.split(",").map(Number);
      if (!isNaN(west) && !isNaN(south) && !isNaN(east) && !isNaN(north)) {
        features = features.filter((f) => {
          if (!f.geometry) return false;
          const coords = (f.geometry as GeoJSON.Point).coordinates;
          if (!coords) return false;
          const [lon, lat] = coords;
          return lon >= west && lon <= east && lat >= south && lat <= north;
        });
      }
    }

    // Apply limit
    features = features.slice(0, limit);

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        numberMatched: features.length,
        numberReturned: features.length,
      },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": `public, max-age=${source.cacheTtl}`,
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
