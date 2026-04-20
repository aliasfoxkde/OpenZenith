/**
 * Shared GIBS WMS tile proxy helper.
 *
 * All GIBS tile routes follow the same pattern:
 * 1. Validate z/x/y parameters
 * 2. Check R2 cache
 * 3. Proxy to GIBS WMS endpoint
 * 4. Cache result in R2
 *
 * This module centralizes that logic.
 */

import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";
import { tileToBboxString } from "@/lib/srtm/zoom-math";

const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";

export interface GIBSLayerConfig {
  /** GIBS WMS layer name (e.g., "MODIS_Terra_L3_NDVI_16Day") */
  layer: string;
  /** R2 cache namespace prefix (e.g., "ndvi") */
  cachePrefix: string;
  /** Minimum zoom level (inclusive) */
  minZoom: number;
  /** Maximum zoom level (inclusive) */
  maxZoom: number;
  /** R2 cache TTL in seconds */
  cacheTtl: number;
}

/**
 * Create a GET handler for a GIBS WMS tile proxy route.
 *
 * Usage in route.ts:
 * ```ts
 * export const runtime = "edge";
 * export const OPTIONS = () => corsPreflightResponse();
 * export const GET = createGIBSHandler({ layer: "...", cachePrefix: "...", minZoom: 1, maxZoom: 9, cacheTtl: 86400 });
 * ```
 */
export function createGIBSHandler(config: GIBSLayerConfig) {
  const { layer, cachePrefix, minZoom, maxZoom, cacheTtl } = config;

  return async function GET(
    _request: Request,
    { params }: { params: Promise<{ z: string; x: string; y: string }> },
  ) {
    const { z, x, y } = await params;
    const zoom = parseInt(z, 10);
    const tileX = parseInt(x, 10);
    const tileY = parseInt(y, 10);

    if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY) || zoom < minZoom || zoom > maxZoom) {
      return new Response("Invalid tile coordinates", { status: 400, headers: CORS_HEADERS });
    }
    const maxTile = Math.pow(2, zoom) - 1;
    if (tileX < 0 || tileX > maxTile || tileY < 0 || tileY > maxTile) {
      return new Response("Tile out of range", { status: 404, headers: CORS_HEADERS });
    }

    // Try R2 cache first
    const cached = await r2GetTile(cachePrefix, zoom, tileX, tileY);
    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": `public, max-age=${cacheTtl}`,
          "X-Cache": "HIT",
          ...CORS_HEADERS,
        },
      });
    }

    // Build WMS request
    const bbox = tileToBboxString(zoom, tileX, tileY);
    const wmsUrl = `${GIBS_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&FORMAT=image/png&TRANSPARENT=TRUE&WIDTH=256&HEIGHT=256&CRS=EPSG:3857&BBOX=${bbox}`;

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
      r2PutTile(cachePrefix, zoom, tileX, tileY, buffer, contentType).catch(() => {});

      return new Response(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": `public, max-age=${cacheTtl}`,
          "X-Cache": "MISS",
          ...CORS_HEADERS,
        },
      });
    } catch {
      return new Response("Failed to fetch tile", { status: 200, headers: CORS_HEADERS });
    }
  };
}

export { corsPreflightResponse as OPTIONS_HANDLER, CORS_HEADERS };
