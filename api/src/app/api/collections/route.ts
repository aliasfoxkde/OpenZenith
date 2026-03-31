import { NextResponse } from "next/server";
import { LAYERS } from "@/lib/layers/registry";

export const runtime = "edge";

/**
 * OGC API - Features collections.
 *
 * Returns available feature collections with metadata.
 * Follows OGC API - Features 1.0 specification.
 */

const BASE_URL = "https://openzenith.cyopsys.com";

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

export async function GET() {
  const collections = FEATURE_COLLECTIONS.map((col) => ({
    id: col.id,
    title: col.title,
    description: col.description,
    links: [
      {
        rel: "self",
        type: "application/geo+json",
        href: `${BASE_URL}/api/collections/${col.id}`,
      },
      {
        rel: "items",
        type: "application/geo+json",
        href: `${BASE_URL}/api/collections/${col.id}/items`,
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
        { rel: "self", type: "application/json", href: `${BASE_URL}/api/collections` },
        { rel: "root", type: "application/json", href: `${BASE_URL}/api` },
      ],
      collections,
      timeStamp: new Date().toISOString(),
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
