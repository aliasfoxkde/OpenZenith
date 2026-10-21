import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/**
 * Marks this route for the Cloudflare Edge runtime, so its handlers execute
 * as Edge Workers rather than in the Node.js server runtime.
 */
export const runtime = "edge";

/**
 * Proxy for Overpass API queries.
 * POST /api/overpass with body: { "query": "[out:json];node(48.85,2.35,48.86,2.36);out 1;" }
 */

/**
 * POST /api/overpass — runs an Overpass API query and relays the result.
 *
 * Expects a JSON body of `{ "query": "<Overpass QL>" }` (e.g.
 * `"[out:json];node(48.85,2.35,48.86,2.36);out 1;"`). A missing or
 * non-string `query` is a 400, as is a query longer than 10000 characters.
 * The query is form-encoded and posted to
 * https://overpass-api.de/api/interpreter under a 30-second abort timeout.
 * Responds 200 with the upstream JSON relayed verbatim and
 * `Cache-Control: public, max-age=60`, 502 when Overpass replies non-OK (an
 * upstream 429/504 error document is deliberately not relayed as a 200), and
 * 502 if the request throws.
 */
export async function POST(request: NextRequest) {
  try {
    // Request body is client-supplied and only inspected for `query`, so it is
    // read as unknown and narrowed below.
    const raw: unknown = await request.json();
    const body = raw as { query?: string };
    const query = body.query;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing query string" }, { status: 400, headers: CORS_HEADERS });
    }

    if (query.length > 10000) {
      return NextResponse.json({ error: "Query too long (max 10000 chars)" }, { status: 400, headers: CORS_HEADERS });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 30000);

    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });

    clearTimeout(timeout);
    if (!resp.ok) {
      // An upstream error document (e.g. Overpass 429/504 with a JSON body)
      // must not be relayed as a green 200.
      return NextResponse.json(
        { error: `Overpass API returned ${resp.status}` },
        { status: 502, headers: CORS_HEADERS },
      );
    }
    // Overpass reply is relayed verbatim — `unknown` is the honest boundary type.
    const data: unknown = await resp.json();

    const headers = new Headers(CORS_HEADERS);
    headers.set("Cache-Control", "public, max-age=60");
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Overpass proxy error";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}

/**
 * CORS preflight for the Overpass proxy endpoint: answers OPTIONS with the
 * shared CORS headers and an empty body.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}
