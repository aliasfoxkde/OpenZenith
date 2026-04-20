import { NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { r2GetJson, r2PutJson, apiCacheKey } from "@/lib/storage/r2-json-cache";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

const NLNOG_API = "https://api.ring.nlnog.net/1.0";

export async function GET() {
  try {
    // Try R2 cache first
    const cacheKey = apiCacheKey("nlnog");
    const cached = await r2GetJson(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600", "X-Cache": "HIT" },
      });
    }

    const resp = await cachedFetch(`${NLNOG_API}/nodes`, CACHE_TTL.NLNOG, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json", "User-Agent": "OpenZenith/1.0" },
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `NLNOG API returned ${resp.status}` }, { status: 200, headers: CORS_HEADERS });
    }

    const data = await resp.json();

    // NLNOG API returns {info: {...}, results: {nodes: [...]}}

    const rawNodes = Array.isArray(data) ? data : data?.results?.nodes || [];

    // Transform nodes to a simpler format with parsed coordinates
    const nodes = rawNodes
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((n: any) => n.geo)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((n: any) => {
        const [lat, lon] = n.geo.split(",").map(Number);
        return {
          id: n.id,
          hostname: n.hostname,
          asn: n.asn,
          ipv4: n.ipv4,
          city: n.city,
          country: n.countrycode,
          lat: isNaN(lat) ? null : lat,
          lon: isNaN(lon) ? null : lon,
        };
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((n: any) => n.lat !== null && n.lon !== null);

    const result = { nodes, count: nodes.length };
    r2PutJson(cacheKey, result, 3600).catch(() => {});
    return NextResponse.json(result, {
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600", "X-Cache": "MISS" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch NLNOG nodes";
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}
