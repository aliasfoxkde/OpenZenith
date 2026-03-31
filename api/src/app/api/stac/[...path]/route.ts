/**
 * STAC (SpatioTemporal Asset Catalog) catalog endpoint.
 *
 * Provides OGC STAC 1.0 compliant collection metadata for
 * all data layers available in OpenZenith.
 *
 * Endpoints:
 *   /api/stac/          — Root catalog
 *   /api/stac/collections — All collections
 *   /api/stac/collections/{id} — Single collection
 */

import { LAYERS } from "@/lib/layers/registry";
import { MAP_2D_LAYER_IDS } from "@/app/map/lib/layers";

export const runtime = "edge";

const STAC_VERSION = "1.0.0";
const BASE_URL = "https://openzenith.cyopsys.com";

function stacLinks(self: string, rel: string, type = "application/json") {
  return [{ rel, href: `${BASE_URL}/api/stac${self}`, type }];
}

function rootCatalog() {
  return {
    stac_version: STAC_VERSION,
    type: "Catalog",
    id: "openzenith",
    title: "OpenZenith Geospatial Intelligence Platform",
    description: "Global monitoring platform with real-time data layers including earthquakes, flights, vessels, satellites, weather, and terrain elevation.",
    keywords: ["geospatial", "intelligence", "monitoring", "earthquakes", "flights", "satellites", "terrain", "weather"],
    license: "proprietary",
    providers: [
      {
        name: "OpenZenith",
        roles: ["host", "processor"],
        url: "https://openzenith.cyopsys.com",
      },
    ],
    links: [
      { rel: "self", href: `${BASE_URL}/api/stac`, type: "application/json" },
      { rel: "root", href: `${BASE_URL}/api/stac`, type: "application/json" },
      { rel: "child", href: `${BASE_URL}/api/stac/collections`, type: "application/json" },
      { rel: "service-desc", href: `${BASE_URL}/api/stac`, type: "application/json" },
    ],
  };
}

interface StacCollection {
  stac_version: string;
  type: "Collection";
  id: string;
  title: string;
  description: string;
  keywords: string[];
  license: string;
  extent: {
    spatial: { bbox: number[][] };
    temporal: { interval: string[][] };
  };
  links: Array<{ rel: string; href: string; type?: string }>;
}

function layerToCollection(layer: typeof LAYERS[number]): StacCollection {
  const bbox: number[][] = layer.id === "satellites"
    ? [[-180, -90, 180, 90]]
    : [[-180, -85, 180, 85]];

  const hasMapLibreLayer = MAP_2D_LAYER_IDS.has(layer.id);

  const links: Array<{ rel: string; href: string; type?: string; title?: string }> = [
    { rel: "self", href: `${BASE_URL}/api/stac/collections/${layer.id}`, type: "application/json" },
    { rel: "parent", href: `${BASE_URL}/api/stac/collections`, type: "application/json" },
    { rel: "root", href: `${BASE_URL}/api/stac`, type: "application/json" },
    { rel: "items", href: `${BASE_URL}/api/stac/collections/${layer.id}/items`, type: "application/geo+json" },
  ];

  // Add data access links for layers with data sources
  if (layer.dataSource) {
    if (hasMapLibreLayer) {
      links.push({
        rel: "tiles",
        href: `${BASE_URL}${layer.dataSource}`,
        type: "application/vnd.mapbox-vector-tile",
        title: "MapLibre vector tiles",
      });
    } else if (layer.dataSource.startsWith("/api/")) {
      links.push({
        rel: "items",
        href: `${BASE_URL}${layer.dataSource}`,
        type: "application/geo+json",
        title: "GeoJSON features",
      });
    }
  }

  return {
    stac_version: STAC_VERSION,
    type: "Collection",
    id: layer.id,
    title: layer.name,
    description: layer.description,
    keywords: [layer.category, "openzenith"],
    license: "varies",
    extent: {
      spatial: { bbox },
      temporal: { interval: [["2024-01-01T00:00:00Z", "2025-12-31T23:59:59Z"]] },
    },
    links,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/stac", "");

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (path === "" || path === "/") {
    return Response.json(rootCatalog(), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  if (path === "/collections") {
    const collections = LAYERS.map(layerToCollection);
    return Response.json(collections, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // Single collection: /collections/{id}
  const collectionMatch = path.match(/^\/collections\/(.+)$/);
  if (collectionMatch) {
    const id = collectionMatch[1];
    const layer = LAYERS.find((l) => l.id === id);
    if (!layer) {
      return Response.json({ error: "Collection not found" }, { status: 404 });
    }
    return Response.json(layerToCollection(layer), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
