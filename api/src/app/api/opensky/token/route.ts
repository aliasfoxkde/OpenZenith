/**
 * OpenSky OAuth2 client-credentials token issuer for the map clients.
 *
 * GET /api/opensky/token - exchanges OPENSKY_CLIENT_ID/SECRET for a bearer
 * token and returns { token, expires_at, cached }. Tokens are memoized in
 * module scope for the life of the isolate and reused until expires_at, so
 * only the first request per token window pays the auth round-trip.
 * No HTTP caching - the credential must not be CDN-shared.
 */
import { NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/**
 * Marks this route for the Cloudflare Edge runtime, so its handlers execute
 * as Edge Workers rather than in the Node.js server runtime.
 */
export const runtime = "edge";

/**
 * CORS preflight for the OpenSky token endpoint: answers OPTIONS with the
 * shared CORS headers and an empty body.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}

// In-memory token cache (Edge runtime — survives across requests within a deployment)
let cachedToken: { access_token: string; expires_at: number } | null = null;

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

async function fetchToken(): Promise<{ access_token: string; expires_at: number } | null> {
  const clientId = process.env["OPENSKY_CLIENT_ID"];
  const clientSecret = process.env["OPENSKY_CLIENT_SECRET"];

  if (!clientId || !clientSecret) return null;

  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: "grant_type=client_credentials",
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as { access_token: string; expires_in: number };
    // Refresh 5 min before expiry
    const expires_at = Date.now() + (data.expires_in - 300) * 1000;
    return { access_token: data.access_token, expires_at };
  } catch {
    return null;
  }
}

/**
 * GET /api/opensky/token — issues an OpenSky Network bearer token to map
 * clients.
 *
 * Exchanges the OPENSKY_CLIENT_ID/OPENSKY_CLIENT_SECRET environment pair for
 * a token via the OpenSky OAuth2 client-credentials grant, and memoizes it in
 * module scope until shortly before it expires so only the first request per
 * token window pays the auth round-trip. Responds 200 with
 * `{ token, expires_at, cached }` — `cached: true` when the memoized token
 * was reused — and 502 when no credentials are configured or the token
 * endpoint cannot be reached. Deliberately sent without HTTP caching
 * headers, since the credential must not be CDN-shared.
 */
export async function GET() {
  // Return cached token if still valid
  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return NextResponse.json({
      token: cachedToken.access_token,
      expires_at: cachedToken.expires_at,
      cached: true,
    });
  }

  // Fetch new token
  const result = await fetchToken();
  if (!result) {
    return NextResponse.json(
      { error: "Failed to obtain OpenSky token", authenticated: false },
      { status: 502, headers: CORS_HEADERS },
    );
  }

  cachedToken = result;

  return NextResponse.json({
    token: result.access_token,
    expires_at: result.expires_at,
    cached: false,
  });
}
