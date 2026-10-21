/**
 * BGP looking-glass proxy over the NLNOG ring.
 *
 * GET /api/bgp?prefix=<cidr> - relays the prefix query to
 * https://lg.ring.nlnog.net/api and returns its JSON response.
 * Caching: Cache-Control: public, max-age=300 (short - routing state moves).
 */
import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/** Marks the route for the Cloudflare edge runtime (Workers) instead of the Node.js server runtime. */
export const runtime = "edge";

/**
 * CORS preflight handler for the BGP looking-glass endpoint: answers the
 * browser's OPTIONS probe with the allowed-origin headers and an empty body.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}

const NLNOG_LG = "https://lg.ring.nlnog.net/api";

/**
 * GET handler for BGP looking-glass prefix queries.
 *
 * Reads the required `prefix` query parameter (a CIDR such as `8.8.8.0/24`;
 * 400 when absent) and relays it to the NLNOG ring looking glass at
 * `lg.ring.nlnog.net/api`, aborting after 15 seconds. The upstream JSON is
 * returned verbatim under a `data` key next to the echoed prefix.
 *
 * A non-OK upstream status becomes 502 and a thrown error becomes 502;
 * responses are publicly cached for 300 seconds because routing state moves quickly.
 */
export async function GET(request: NextRequest) {
  const prefix = request.nextUrl.searchParams.get("prefix");
  if (!prefix) {
    return NextResponse.json(
      { error: "Missing required parameter: prefix (e.g. 8.8.8.0/24)" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 15000);

    const resp = await fetch(`${NLNOG_LG}/prefix?q=${encodeURIComponent(prefix)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "OpenZenith/1.0" },
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      return NextResponse.json(
        { error: `NLNOG Looking Glass returned ${resp.status}` },
        { status: 502, headers: CORS_HEADERS },
      );
    }

    // Looking-glass result is relayed verbatim — the route never interprets it,
    // so `unknown` is the honest boundary type.
    const data: unknown = await resp.json();

    return NextResponse.json(
      { prefix, data },
      {
        headers: {
          ...CORS_HEADERS,
          "Cache-Control": "public, max-age=300",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to query BGP data";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
