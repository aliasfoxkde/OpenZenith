import { NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS } from "@/lib/cors";

export const runtime = "edge";

const NLNOG_API = "https://api.ring.nlnog.net/1.0";

export async function GET() {
  try {
    const resp = await cachedFetch(`${NLNOG_API}/nodes`, CACHE_TTL.NLNOG, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json", "User-Agent": "OpenZenith/1.0" },
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `NLNOG API returned ${resp.status}` }, { status: 502, headers: CORS_HEADERS });
    }

    const data = await resp.json();

    // Transform nodes to a simpler format with parsed coordinates
    const nodes = Array.isArray(data)
      ? data
          .filter((n: any) => n.geo)
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
          .filter((n: any) => n.lat !== null && n.lon !== null)
      : [];

    return NextResponse.json(
      { nodes, count: nodes.length },
      {
        headers: {
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch NLNOG nodes";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
