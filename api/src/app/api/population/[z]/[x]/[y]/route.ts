/**
 * Population density tile proxy.
 *
 * Proxies WMS tiles from NASA GIBS VIIRS Black Marble dataset.
 * Replaced JRC GHSL WMS (EEA infrastructure discontinued 2025).
 * VIIRS Black Marble is a strong proxy for human settlement density.
 */

import { corsPreflightResponse, CORS_HEADERS } from "@/lib/cors";
import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

import { tileToBboxString } from "@/lib/srtm/zoom-math";

const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";
const LAYER = "VIIRS_Black_Marble";

export async function GET(request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY) || zoom < 1 || zoom > 8) {
    return new Response("Invalid tile coordinates", { status: 400, headers: CORS_HEADERS });
  }
  const maxTile = Math.pow(2, zoom) - 1;
  if (tileX < 0 || tileX > maxTile || tileY < 0 || tileY > maxTile) {
    return new Response("Tile out of range", { status: 404, headers: CORS_HEADERS });
  }

  // Try R2 cache first
  const cached = await r2GetTile("population", zoom, tileX, tileY);
  if (cached) {
    return new Response(cached, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "X-Cache": "HIT",
        ...CORS_HEADERS,
      },
    });
  }

  const bbox = tileToBboxString(zoom, tileX, tileY);
  const wmsUrl = `${GIBS_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${LAYER}&FORMAT=image/png&WIDTH=256&HEIGHT=256&CRS=EPSG:3857&BBOX=${bbox}`;

  try {
    const res = await fetch(wmsUrl, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });
    if (!res.ok) {
      return new Response("Tile not available", { status: res.status, headers: CORS_HEADERS });
    }
    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = await res.arrayBuffer();
    r2PutTile("population", zoom, tileX, tileY, buffer, contentType).catch(() => {});
    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "X-Cache": "MISS",
        ...CORS_HEADERS,
      },
    });
  } catch {
    return new Response("Failed to fetch tile", { status: 200, headers: CORS_HEADERS });
  }
}
