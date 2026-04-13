import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

const COLLECTIONS: Record<string, { title: string; description: string }> = {
  earthquakes: {
    title: "Earthquakes",
    description: "Real-time earthquake data from USGS (magnitude, depth, location)",
  },
  natural_events: {
    title: "Natural Events",
    description: "NASA EONET natural events (volcanoes, wildfires, icebergs)",
  },
  wildfires: {
    title: "Active Fires",
    description: "NASA FIRMS active fire/hotspot detection (VIIRS satellite)",
  },
  nlnog_nodes: {
    title: "NLNOG Nodes",
    description: "NLNOG Ring measurement nodes worldwide",
  },
  warnings: {
    title: "Weather Warnings",
    description: "NWS watches, warnings, and advisories (US only)",
  },
  waterways: {
    title: "Waterways",
    description: "Rivers, lakes, and water features from HydroSHEDS and OSM",
  },
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const baseUrl = new URL(request.url).origin;
  const { id } = await params;
  const col = COLLECTIONS[id];

  if (!col) {
    return Response.json(
      { code: "NotFound", description: `Collection '${id}' not found` },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(
    {
      id,
      title: col.title,
      description: col.description,
      links: [
        { rel: "self", type: "application/json", href: `${baseUrl}/api/collections/${id}` },
        { rel: "items", type: "application/geo+json", href: `${baseUrl}/api/collections/${id}/items` },
        { rel: "root", type: "application/json", href: `${baseUrl}/api` },
      ],
      extent: {
        spatial: { bbox: [-180, -90, 180, 90], crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
      },
      crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      itemType: "feature",
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
