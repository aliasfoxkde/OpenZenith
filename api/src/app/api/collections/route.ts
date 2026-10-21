import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsError, corsPreflightResponse } from "@/lib/cors";

/** Marks the route for the Cloudflare edge runtime (Workers) instead of the Node.js server runtime. */
export const runtime = "edge";

/**
 * CORS preflight handler for the OGC collections list endpoint: answers the
 * browser's OPTIONS probe with the allowed-origin headers and an empty body.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * OGC API - Features collections.
 *
 * Returns available feature collections with metadata.
 * Follows OGC API - Features 1.0 specification.
 */

// Map internal layer IDs to OGC collections
const FEATURE_COLLECTIONS = [
  {
    id: "earthquakes",
    title: "Earthquakes",
    description: "Real-time earthquake data from USGS",
    dataSource: "/api/proxy/https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    itemType: "feature",
  },
  {
    id: "natural_events",
    title: "Natural Events",
    description: "NASA EONET natural events (volcanoes, wildfires, icebergs)",
    dataSource: "/api/proxy/https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200",
    itemType: "feature",
  },
  {
    id: "wildfires",
    title: "Active Fires",
    description: "NASA FIRMS active fire/hotspot detection (VIIRS satellite)",
    dataSource: "/api/wildfires",
    itemType: "feature",
  },
  {
    id: "nlnog_nodes",
    title: "NLNOG Nodes",
    description: "NLNOG Ring measurement nodes worldwide",
    dataSource: "/api/nlnog",
    itemType: "feature",
  },
];

/**
 * GET handler listing the available OGC API - Features collections.
 *
 * Maps the internal layer registry to OGC collection entries — id, title,
 * description, self and items links, the global CRS84 spatial extent and the
 * `feature` item type — and returns them in an OGC document with self/root
 * links and a `timeStamp`.
 *
 * The listing is publicly cached for 3600 seconds; an unexpected failure
 * returns 500.
 */
export function GET(request: NextRequest) {
  try {
    const baseUrl = new URL(request.url).origin;
    const collections = FEATURE_COLLECTIONS.map((col) => ({
      id: col.id,
      title: col.title,
      description: col.description,
      links: [
        {
          rel: "self",
          type: "application/geo+json",
          href: `${baseUrl}/api/collections/${col.id}`,
        },
        {
          rel: "items",
          type: "application/geo+json",
          href: `${baseUrl}/api/collections/${col.id}/items`,
        },
      ],
      extent: {
        spatial: {
          bbox: [-180, -90, 180, 90],
          crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
        },
      },
      crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      itemType: col.itemType,
    }));

    return NextResponse.json(
      {
        links: [
          { rel: "self", type: "application/json", href: `${baseUrl}/api/collections` },
          { rel: "root", type: "application/json", href: `${baseUrl}/api` },
        ],
        collections,
        timeStamp: new Date().toISOString(),
      },
      {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        },
      },
    );
  } catch (error) {
    console.error("Collections endpoint failed:", error);
    return corsError("Failed to fetch collections", 500);
  }
}
