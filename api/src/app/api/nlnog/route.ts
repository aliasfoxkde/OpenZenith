import { NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { edgeGetJson, edgePutJson, apiCacheKey } from "@/lib/storage/edge-cache";

/**
 * Marks this route for the Cloudflare Edge runtime, so its handlers execute
 * as Edge Workers rather than in the Node.js server runtime.
 */
export const runtime = "edge";

// Preflight has nothing to await — stay promise-returning because callers await handlers.
/**
 * CORS preflight for the NLNOG nodes endpoint: answers OPTIONS with the
 * shared CORS headers and an empty body.
 */
export function OPTIONS() {
  return Promise.resolve(corsPreflightResponse());
}

const NLNOG_API = "https://api.ring.nlnog.net/1.0";

/** One entry of the NLNOG `nodes` list. Coordinates arrive as a "lat,lon" string. */
interface NlnogNode {
  id?: number;
  hostname?: string;
  asn?: number;
  ipv4?: string;
  city?: string;
  countrycode?: string;
  geo?: string;
}

/**
 * NLNOG API returns {info: {...}, results: {nodes: [...]}}; some deployments
 * answer with a bare node array. Anything else falls through to `[]` below.
 */
type NlnogResponse = NlnogNode[] | { results?: { nodes?: NlnogNode[] } };

/**
 * GET /api/nlnog — lists the public NLNOG (Network Lookup for Non-Commercial
 * & Open Groups) probe nodes.
 *
 * Serves the node list from https://api.ring.nlnog.net/1.0/nodes, first
 * checking the edge Cache API and writing the fresh document back to it for
 * an hour. Each node's `geo` field ("lat,lon") is parsed into numeric
 * `lat`/`lon`, and nodes whose coordinates cannot be parsed are dropped.
 * Responds 200 with `{ nodes, count }` (plus `X-Cache: HIT`/`MISS`), 502 when
 * the upstream replies non-OK or the request throws.
 */
export async function GET() {
  try {
    // Try R2 cache first
    const cacheKey = apiCacheKey("nlnog");
    const cached = await edgeGetJson(cacheKey);
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
      return NextResponse.json({ error: `NLNOG API returned ${resp.status}` }, { status: 502, headers: CORS_HEADERS });
    }

    const data = (await resp.json()) as NlnogResponse | null;

    const rawNodes = Array.isArray(data) ? data : data?.results?.nodes || [];

    // Transform nodes to a simpler format with parsed coordinates
    const nodes = rawNodes
      .filter((n): n is NlnogNode & { geo: string } => Boolean(n.geo))
      .map((n) => {
        const parts = n.geo.split(",").map(Number);
        // A missing part is undefined; ?? NaN makes isNaN() treat it exactly
        // as it did before (undefined coerces to NaN).
        const lat = parts[0] ?? NaN;
        const lon = parts[1] ?? NaN;
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
      .filter((n) => n.lat !== null && n.lon !== null);

    const result = { nodes, count: nodes.length };
    edgePutJson(cacheKey, result, 3600).catch(() => {});
    return NextResponse.json(result, {
      headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=3600", "X-Cache": "MISS" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch NLNOG nodes";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
