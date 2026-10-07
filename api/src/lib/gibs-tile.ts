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

import { CORS_HEADERS, corsError, corsPreflightResponse } from "@/lib/cors";
import { edgeGetTile, edgePutTile } from "@/lib/storage/edge-cache";
import { tileToBboxString } from "@/lib/srtm/zoom-math";
import { parseTileParams } from "@/lib/tile-params";

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

  return async function GET(_request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
    const { z, x, y } = await params;
    const parsed = parseTileParams(z, x, y, { minZoom, maxZoom });
    if (!parsed.ok) return corsError(parsed.message, parsed.status);
    const { z: zoom, x: tileX, y: tileY } = parsed;

    // Try edge cache first
    const cached = await edgeGetTile(cachePrefix, zoom, tileX, tileY);
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
        // A GIBS 404 means the layer has no coverage for this tile (normal for
        // sparse products); anything else is an upstream failure we report as
        // 502 so clients can distinguish "no data here" from "source down".
        // The historical 200-on-failure contract made MapLibre try to decode a
        // text body as a PNG and hid outages as "empty" layers.
        if (res.status === 404) {
          return corsError("Tile not available from GIBS", 404);
        }
        return corsError(`GIBS request failed (upstream ${res.status})`, 502);
      }

      const contentType = res.headers.get("content-type") || "image/png";
      const buffer = await res.arrayBuffer();
      edgePutTile(cachePrefix, zoom, tileX, tileY, buffer, contentType).catch(() => {});

      return new Response(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": `public, max-age=${cacheTtl}`,
          "X-Cache": "MISS",
          ...CORS_HEADERS,
        },
      });
    } catch {
      return corsError("Failed to fetch tile from GIBS", 502);
    }
  };
}

export { corsPreflightResponse as OPTIONS_HANDLER, CORS_HEADERS };
