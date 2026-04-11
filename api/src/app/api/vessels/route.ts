import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * GET /api/vessels
 *
 * Returns AISstream.io configuration for client-side WebSocket connection.
 * If AISSTREAM_KEY is set, returns the WebSocket URL and key.
 * Otherwise returns a helpful error message.
 */
export async function GET(_request: NextRequest) {
  const apiKey = process.env.AISSTREAM_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "AISSTREAM_KEY not configured",
        message: "Set AISSTREAM_KEY in .env.local to enable vessel tracking",
        wsUrl: "wss://stream.aisstream.io/v0/stream",
        signupUrl: "https://www.aisstream.io/",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    wsUrl: "wss://stream.aisstream.io/v0/stream",
    apiKey,
    messageTypes: ["PositionReport"],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
