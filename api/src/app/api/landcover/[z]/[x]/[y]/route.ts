/**
 * CORINE Land Cover tile proxy.
 *
 * Proxies WMS tiles from EEA (European Environment Agency)
 * CORINE Land Cover 2018 dataset.
 */

import { corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

import { tileToLatLon } from "@/lib/srtm/zoom-math";

export async function GET(request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;

  const wmsUrl = new URL("https://image.discomap.eea.europa.eu/arcgis/services/CLMS/CLMS_CORINE/MapServer/WMSServer");
  wmsUrl.searchParams.set("SERVICE", "WMS");
  wmsUrl.searchParams.set("VERSION", "1.3.0");
  wmsUrl.searchParams.set("REQUEST", "GetMap");
  wmsUrl.searchParams.set("LAYERS", "1");
  wmsUrl.searchParams.set("FORMAT", "image/png");
  wmsUrl.searchParams.set("TRANSPARENT", "TRUE");
  wmsUrl.searchParams.set("WIDTH", "256");
  wmsUrl.searchParams.set("HEIGHT", "256");
  wmsUrl.searchParams.set("CRS", "EPSG:3857");
  wmsUrl.searchParams.set("STYLES", "");

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
        "Cache-Control": "public, max-age=604800",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("Failed to fetch tile", {
      status: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
}
