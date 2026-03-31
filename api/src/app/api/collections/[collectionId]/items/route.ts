import { NextResponse } from "next/server";

export const runtime = "edge";

/**
 * OGC API - Features items for a specific collection.
 *
 * Returns GeoJSON features with support for bbox filtering and pagination.
 * Follows OGC API - Features 1.0 specification.
 */

const BASE_URL = "https://openzenith.cyopsys.com";

const COLLECTIONS: Record<string, { dataSource: string }> = {
  earthquakes: {
    dataSource: "/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  },
  natural_events: {
    dataSource: "/api/proxy/https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200",
  },
  wildfires: {
    dataSource: "/api/wildfires",
  },
  nlnog_nodes: {
    dataSource: "/api/nlnog",
  },
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;
  const col = COLLECTIONS[collectionId];

  if (!col) {
    return NextResponse.json(
      { code: "NotFound", description: `Collection '${collectionId}' not found` },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const bbox = url.searchParams.get("bbox");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset = parseInt(url.searchParams.get("offset") || "0");

  try {
    const resp = await fetch(col.dataSource, {
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${resp.status}` },
        { status: 502 },
      );
    }

    let data = await resp.json();

    // NLNOG returns a different format — convert to GeoJSON
    if (collectionId === "nlnog_nodes" && data.nodes) {
      data = {
        type: "FeatureCollection",
        features: data.nodes
          .filter((n: any) => n.lat != null && n.lon != null)
          .map((n: any) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [n.lon, n.lat] },
            properties: {
              id: n.id,
              hostname: n.hostname,
              asn: n.asn,
              city: n.city,
              country: n.country,
            },
          })),
      };
    }

    // Ensure GeoJSON FeatureCollection
    let features = data.features || [];

    // Apply bbox filter
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

    // Apply pagination
    const total = features.length;
    features = features.slice(offset, offset + limit);

    const hasNext = offset + limit < total;

    return NextResponse.json(
      {
        type: "FeatureCollection",
        features,
        links: [
          { rel: "self", type: "application/geo+json", href: url.toString() },
          {
            rel: "root",
            type: "application/json",
            href: `${BASE_URL}/api/collections`,
          },
          {
            rel: "collection",
            type: "application/json",
            href: `${BASE_URL}/api/collections/${collectionId}`,
          },
          ...(hasNext
            ? [
                {
                  rel: "next",
                  type: "application/geo+json",
                  href: `${BASE_URL}/api/collections/${collectionId}/items?offset=${offset + limit}&limit=${limit}`,
                },
              ]
            : []),
        ],
        numberMatched: total,
        numberReturned: features.length,
        timeStamp: new Date().toISOString(),
      },
      {
        headers: {
          "Content-Type": "application/geo+json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch collection data";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
