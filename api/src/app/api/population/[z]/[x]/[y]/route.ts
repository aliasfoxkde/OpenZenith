/**
 * Population density tile proxy.
 *
 * Proxies WMS tiles from JRC GHSL (Global Human Settlement Layer)
 * to avoid CORS issues in the browser.
 */

import { corsPreflightResponse, CORS_HEADERS } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

import { tileToLatLon } from "@/lib/srtm/zoom-math";

export async function GET(request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;

  // Use JRC GHSL WMS service
  const wmsUrl = new URL("https://image.discomap.eea.europa.eu/arcgis/services/GHSL/GHS_POP_2025/MapServer/WMSServer");
  wmsUrl.searchParams.set("SERVICE", "WMS");
  wmsUrl.searchParams.set("VERSION", "1.3.0");
  wmsUrl.searchParams.set("REQUEST", "GetMap");
  wmsUrl.searchParams.set("LAYERS", "0");
  wmsUrl.searchParams.set("FORMAT", "image/png");
  wmsUrl.searchParams.set("TRANSPARENT", "TRUE");
  wmsUrl.searchParams.set("WIDTH", "256");
  wmsUrl.searchParams.set("HEIGHT", "256");
  wmsUrl.searchParams.set("CRS", "EPSG:3857");
  wmsUrl.searchParams.set("STYLES", "");

  // Validate tile coordinates
  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY) || zoom < 0 || zoom > 22) {
    return new Response("Invalid tile coordinates", { status: 400 });
  }
  const maxTile = Math.pow(2, zoom) - 1;
  if (tileX < 0 || tileX > maxTile || tileY < 0 || tileY > maxTile) {
    return new Response("Tile out of range", { status: 404 });
  }

  // Convert XYZ tile bounds to WGS84 bbox for WMS

  // WMS 1.3.0 uses axis order depending on CRS — EPSG:4326 is lat,lon
  const { north, south, east, west } = tileToLatLon(zoom, tileX, tileY);
  wmsUrl.searchParams.set("BBOX", `${south},${west},${north},${east}`);

  try {
    const res = await fetch(wmsUrl.toString(), {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!res.ok) {
      return new Response("Tile not available", { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        ...CORS_HEADERS,
      },
    });
  } catch {
    return new Response("Failed to fetch tile", {
      status: 502,
      headers: CORS_HEADERS,
    });
  }
}
