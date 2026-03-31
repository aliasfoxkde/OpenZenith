import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * OGC API - Features items endpoint.
 *
 * Returns GeoJSON features for a given collection with support for:
 * - bbox filtering
 * - pagination (limit/offset)
 * - CQL2-like filtering (simple property filters)
 *
 * Follows OGC API - Features 1.0 specification.
 */

const BASE_URL = "https://openzenith.cyopsys.com";

// Data source mapping: collection ID -> upstream GeoJSON URL
const COLLECTION_SOURCES: Record<string, { url: string; cacheTtl: number }> = {
  earthquakes: {
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    cacheTtl: 60,
  },
  natural_events: {
    url: "https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200",
    cacheTtl: 300,
  },
  wildfires: {
    url: `${BASE_URL}/api/wildfires`,
    cacheTtl: 3600,
  },
  nlnog_nodes: {
    url: `${BASE_URL}/api/nlnog`,
    cacheTtl: 3600,
  },
  warnings: {
    url: `${BASE_URL}/api/weather/warnings`,
    cacheTtl: 120,
  },
  waterways: {
    url: `${BASE_URL}/api/waterways?lat=40.7&lon=-74.0&radius=50`,
    cacheTtl: 86400,
  },
};

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = COLLECTION_SOURCES[id];

  if (!source) {
    return NextResponse.json(
      {
        code: "NotFound",
        description: `Collection '${id}' not found`,
      },
      { status: 404, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 10000);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10) || 0;
  const bbox = url.searchParams.get("bbox");
  const properties = url.searchParams.get("properties");

  try {
    const res = await fetch(source.url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream data source returned ${res.status}` },
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const data = await res.json();

    // Normalize to GeoJSON FeatureCollection
    let features = data.features || [];

    // Bbox filtering: bbox=minLon,minLat,maxLon,maxLat
    if (bbox) {
      const [minLon, minLat, maxLon, maxLat] = bbox.split(",").map(Number);
      features = features.filter((f: any) => {
        const coords = f.geometry?.coordinates;
        if (!coords) return false;
        const lon = coords[0];
        const lat = coords[1];
        return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
      });
    }

    // Simple property filtering: properties=field:value
    if (properties) {
      const filters = properties.split(",").map((f) => {
        const [key, val] = f.split(":");
        return { key, val };
      });

      features = features.filter((f: any) => {
        return filters.every(({ key, val }) => {
          const prop = f.properties?.[key];
          if (prop === undefined) return false;
          // Numeric comparison
          const numVal = parseFloat(val);
          if (!isNaN(numVal)) {
            // Support operators: >5, <10, >=5, <=10, 5
            if (val.startsWith(">=")) return prop >= parseFloat(val.slice(2));
            if (val.startsWith("<=")) return prop <= parseFloat(val.slice(2));
            if (val.startsWith(">")) return prop > parseFloat(val.slice(1));
            if (val.startsWith("<")) return prop < parseFloat(val.slice(1));
            return prop === numVal;
          }
          // String comparison (case-insensitive)
          return String(prop).toLowerCase() === val.toLowerCase();
        });
      });
    }

    const total = features.length;
    const paged = features.slice(offset, offset + limit);
    const hasNext = offset + limit < total;

    // Build next/prev links
    const links = [
      { rel: "self", type: "application/geo+json", href: `${BASE_URL}/api/collections/${id}/items?limit=${limit}&offset=${offset}` },
      { rel: "collection", type: "application/json", href: `${BASE_URL}/api/collections/${id}` },
      { rel: "root", type: "application/json", href: `${BASE_URL}/api` },
    ];

    if (hasNext) {
      links.push({ rel: "next", type: "application/geo+json", href: `${BASE_URL}/api/collections/${id}/items?limit=${limit}&offset=${offset + limit}` });
    }
    if (offset > 0) {
      links.push({ rel: "prev", type: "application/geo+json", href: `${BASE_URL}/api/collections/${id}/items?limit=${limit}&offset=${Math.max(0, offset - limit)}` });
    }

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features: paged,
        links,
        timeStamp: new Date().toISOString(),
        numberMatched: total,
        numberReturned: paged.length,
      },
      {
        headers: {
          "Content-Type": "application/geo+json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": `public, max-age=${source.cacheTtl}`,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch features";
    return NextResponse.json(
      { error: message },
      { status: 502, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}
