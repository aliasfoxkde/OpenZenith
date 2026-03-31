/**
 * Sentinel-2 satellite imagery tile proxy.
 *
 * Uses Microsoft Planetary Computer STAC API to access
 * recent Sentinel-2 imagery as Cloud-Optimized GeoTIFF tiles.
 */

export const runtime = "edge";

// Sentinel-2 visual (true color) collection on Planetary Computer
const STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const TITILER = "https://titiler.planetarycomputer.microsoft.gov/cog/tiles/{z}/{x}/{y}";

let cachedAssetUrl: string | null = null;
let cachedAt = 0;
const CACHE_TTL = 3600000; // 1 hour

async function findRecentSentinel2Tile(bbox: string): Promise<string | null> {
  // Search for recent Sentinel-2 L2A item
  const res = await fetch(STAC_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collections: ["sentinel-2-l2a"],
      bbox: bbox.split(",").map(Number),
      limit: 1,
      sortby: [{ field: "properties.datetime", direction: "desc" }],
      query: {
        "eo:cloud_cover": { lt: 30 },
      },
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.features?.length) return null;

  const item = data.features[0];
  const visualAsset = item.assets?.visual || item.assets?.["TCI"] || item.assets?.["tci"];
  if (!visualAsset?.href) return null;

  return visualAsset.href;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await params;

  // Convert tile to bbox for STAC search
  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(y, 10);

  const n = Math.pow(2, zoom);
  const lon1 = (tileX / n) * 360 - 180;
  const lon2 = ((tileX + 1) / n) * 360 - 180;
  const lat1Rad = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n)));
  const lat2Rad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + 1) / n)));
  const lat1 = (lat1Rad * 180) / Math.PI;
  const lat2 = (lat2Rad * 180) / Math.PI;
  const bbox = `${lon1},${lat2},${lon2},${lat1}`;

  // For global/low zoom tiles, use a default area (continents)
  const searchBbox = zoom < 6 ? "-180,-60,180,70" : bbox;

  try {
    // Find a recent Sentinel-2 item (cached for 1 hour)
    let assetUrl: string | null = cachedAssetUrl;
    if (!assetUrl || Date.now() - cachedAt > CACHE_TTL) {
      assetUrl = await findRecentSentinel2Tile(searchBbox);
      if (assetUrl) {
        cachedAssetUrl = assetUrl;
        cachedAt = Date.now();
      }
    }

    if (!assetUrl) {
      return new Response("No recent Sentinel-2 imagery available", { status: 404 });
    }

    // Fetch tile from TiTiler
    const titilerUrl = `https://titiler.planetarycomputer.microsoft.gov/cog/tiles/${z}/${x}/${y}?url=${encodeURIComponent(assetUrl)}&rescale=0,3000&color_map=viridis&bidx=1,2,3`;

    const tileRes = await fetch(titilerUrl, {
      headers: {
        "User-Agent": "OpenZenith/1.0",
      },
    });

    if (!tileRes.ok) {
      return new Response("Tile not available", { status: tileRes.status });
    }

    const buffer = await tileRes.arrayBuffer();
    const contentType = tileRes.headers.get("content-type") || "image/png";

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Failed to fetch tile", { status: 502 });
  }
}
