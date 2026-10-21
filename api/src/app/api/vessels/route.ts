import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/**
 * Marks this route for the Cloudflare edge runtime, where the Workers
 * Cache API that fronts the upstream data is available.
 */
export const runtime = "edge";

/**
 * GET /api/vessels
 *
 * Returns AISstream.io configuration for client-side WebSocket connection.
 * If AISSTREAM_KEY is set, returns the WebSocket URL and key.
 * Otherwise returns empty config with helpful message.
 */
export function GET(_request: NextRequest) {
  const apiKey = process.env.AISSTREAM_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "AISSTREAM_KEY not configured",
        message: "Register free at https://www.aisstream.io/ and set AISSTREAM_KEY",
        wsUrl: null,
        apiKey: null,
        configured: false,
      },
      { status: 200, headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=60" } },
    );
  }

  return NextResponse.json(
    {
      wsUrl: "wss://stream.aisstream.io/v0/stream",
      apiKey,
      messageTypes: ["PositionReport"],
      configured: true,
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}

/**
 * Answers the CORS preflight for the AISstream vessel configuration
 * endpoint with a 204 and the shared CORS headers, so browser clients can
 * open the vessel WebSocket stream cross-origin.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}
