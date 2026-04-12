import { NextRequest } from "next/server";

export const runtime = "edge";

/**
 * Generic tile proxy endpoint.
 *
 * Proxies tile requests (XYZ, TMS, WMTS) to external tile servers,
 * adding CORS headers. Supports template substitution for WMTS URLs.
 *
 * Usage: GET /api/proxy/tile?url=<encoded_url_template>&z={z}&x={x}&y={y}
 *   or: GET /api/proxy/tile?url=<encoded_url_template>&z={z}&x={x}&y={y}&reverse_y=true
 *
 * Example:
 *   /api/proxy/tile?url=https://tile.server.com/%7Bz%7D/%7Bx%7D/%7By%7D.png&z=10&x=512&y=384
 */

import { CORS_HEADERS, corsError } from "@/lib/cors";

/** Hostnames allowed for tile proxy requests. */
const ALLOWED_TILE_HOSTS = [
  "basemaps.cartocdn.com",
  "server.arcgisonline.com",
  "tile.openstreetmap.org",
  "tile.opentopomap.org",
  "tiles.overturemaps.org",
  "tilecache.rainviewer.com",
  "gibs.earthdata.nasa.gov",
  "map1.vis.earthdata.nasa.gov",
  "services.arcgis.com",
  "services7.arcgis.com",
  "gis.fema.gov",
  "a.tile.openstreetmap.org",
  "b.tile.openstreetmap.org",
  "c.tile.openstreetmap.org",
  "example.com",
];

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const urlTemplate = searchParams.get("url");
  const z = searchParams.get("z");
  const x = searchParams.get("x");
  const y = searchParams.get("y");
  const reverseY = searchParams.get("reverse_y") === "true";

  if (!urlTemplate || !z || !x || !y) {
    return corsError("Missing required parameters: url, z, x, y", 400);
  }

  // Validate z/x/y are numbers
  const zNum = parseInt(z, 10);
  const xNum = parseInt(x, 10);
  const yNum = parseInt(y, 10);
  if (isNaN(zNum) || isNaN(xNum) || isNaN(yNum)) {
    return corsError("z, x, y must be integers", 400);
  }

  // Template substitution
  const actualY = reverseY ? Math.pow(2, zNum) - 1 - yNum : yNum;
  const tileUrl = urlTemplate
    .replace("{z}", String(zNum))
    .replace("{x}", String(xNum))
    .replace("{y}", String(actualY))
    .replace("%7Bz%7D", String(zNum))
    .replace("%7Bx%7D", String(xNum))
    .replace("%7By%7D", String(actualY));

  // Validate resulting URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(tileUrl);
  } catch {
    return corsError("Invalid tile URL after template substitution", 400);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return corsError("Only HTTP/HTTPS URLs allowed", 400);
  }

  if (!ALLOWED_TILE_HOSTS.includes(parsedUrl.hostname)) {
    return corsError("Domain not allowed", 403);
  }

  try {
    const response = await fetch(tileUrl, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Transparent pixel for missing tiles
        const transparent = new Uint8Array([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a, // PNG header
          0x00,
          0x00,
          0x00,
          0x0d,
          0x49,
          0x48,
          0x44,
          0x52, // IHDR chunk
          0x00,
          0x00,
          0x00,
          0x01,
          0x00,
          0x00,
          0x00,
          0x01, // 1x1
          0x08,
          0x06,
          0x00,
          0x00,
          0x00,
          0x1f,
          0x15,
          0xc4, // RGBA
          0x89,
          0x00,
          0x00,
          0x00,
          0x0a,
          0x49,
          0x44,
          0x41, // IDAT chunk
          0x54,
          0x78,
          0x9c,
          0x62,
          0x00,
          0x00,
          0x00,
          0x02,
          0x00,
          0x01,
          0xe5,
          0x27,
          0xde,
          0xfc,
          0x00,
          0x00,
          0x00,
          0x00,
          0x49,
          0x45,
          0x4e,
          0x44,
          0xae,
          0x42, // IEND chunk
          0x60,
          0x82,
        ]);
        return new Response(transparent.buffer, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
      return corsError(`Tile server error: ${response.status}`, response.status);
    }

    const contentType = response.headers.get("Content-Type") || "image/png";
    const cacheControl = response.headers.get("Cache-Control") || "public, max-age=86400";

    return new Response(response.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    });
  } catch (error) {
    console.error("Tile proxy error:", error);
    return corsError("Failed to fetch tile", 502);
  }
}
