/**
 * Sentinel-2 satellite imagery tile proxy.
 *
 * Primary: Microsoft Planetary Computer STAC + TiTiler COG tiles.
 * Fallback: NASA GIBS MODIS Terra True Color when TiTiler is unavailable.
 *
 * TiTiler has been intermittently down since 2025; the GIBS fallback
 * ensures the layer always returns imagery (~2 day processing delay).
 */

import { corsPreflightResponse, CORS_HEADERS } from "@/lib/cors";
import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

import { tileToBboxString } from "@/lib/srtm/zoom-math";

const STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";
const GIBS_MODIS = "MODIS_Terra_CorrectedReflectance_TrueColor";

let cachedAssetUrl: string | null = null;
let cachedAt = 0;
const CACHE_TTL = 3600000; // 1 hour

async function findRecentSentinel2Tile(bbox: string): Promise<string | null> {
  try {
    const res = await fetch(STAC_SEARCH, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collections: ["sentinel-2-l2a"],
        bbox: bbox.split(",").map(Number),
        limit: 1,
        sortby: [{ field: "properties.datetime", direction: "desc" }],
        query: { "eo:cloud_cover": { lt: 30 } },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.features?.length) return null;
    const item = data.features[0];
    const visualAsset = item.assets?.visual || item.assets?.["TCI"] || item.assets?.["tci"];
    return visualAsset?.href || null;
  } catch {
    return null;
  }
}

/** Fetch MODIS True Color from GIBS as fallback. */
async function fetchGibsFallback(zoom: number, tileX: number, tileY: number): Promise<ArrayBuffer | null> {
  const bbox = tileToBboxString(zoom, tileX, tileY);
  const url = `${GIBS_WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${GIBS_MODIS}&FORMAT=image/png&WIDTH=256&HEIGHT=256&CRS=EPSG:3857&BBOX=${bbox}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY) || zoom < 0 || zoom > 22) {
    return new Response("Invalid tile coordinates", { status: 400, headers: CORS_HEADERS });
  }
  const maxTile = Math.pow(2, zoom) - 1;
  if (tileX < 0 || tileX > maxTile || tileY < 0 || tileY > maxTile) {
    return new Response("Tile out of range", { status: 404, headers: CORS_HEADERS });
  }

  const bbox = tileToBboxString(zoom, tileX, tileY);
  const searchBbox = zoom < 6 ? "-180,-60,180,70" : bbox;

  // Check R2 cache first
  const cached = await r2GetTile("sentinel2", zoom, tileX, tileY);
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Cache": "HIT", ...CORS_HEADERS },
    });
  }

  // Try TiTiler + STAC pipeline
  let assetUrl = cachedAssetUrl;
  if (!assetUrl || Date.now() - cachedAt > CACHE_TTL) {
    assetUrl = await findRecentSentinel2Tile(searchBbox);
    if (assetUrl) { cachedAssetUrl = assetUrl; cachedAt = Date.now(); }
  }

  if (assetUrl) {
    const titlerUrl = `https://titiler.planetarycomputer.microsoft.gov/cog/tiles/${z}/${x}/${y}?url=${encodeURIComponent(assetUrl)}&rescale=0,3000&color_map=viridis&bidx=1,2,3`;
    try {
      const tileRes = await fetch(titlerUrl, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "OpenZenith/1.0" } });
      if (tileRes.ok) {
        const buffer = await tileRes.arrayBuffer();
        r2PutTile("sentinel2", zoom, tileX, tileY, buffer, "image/png").catch(() => {});
        return new Response(buffer, {
          headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Cache": "MISS", ...CORS_HEADERS },
        });
      }
    } catch {
      // TiTiler down — fall through to GIBS
    }
  }

  // Fallback: NASA GIBS MODIS True Color
  const gibsBuffer = await fetchGibsFallback(zoom, tileX, tileY);
  if (gibsBuffer) {
    r2PutTile("sentinel2", zoom, tileX, tileY, gibsBuffer, "image/png").catch(() => {});
    return new Response(gibsBuffer, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Cache": "MISS-GIBS", ...CORS_HEADERS },
    });
  }

  return new Response("Imagery temporarily unavailable", { status: 502, headers: CORS_HEADERS });
}
