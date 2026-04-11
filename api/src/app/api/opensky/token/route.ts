import { NextResponse } from "next/server";

export const runtime = "edge";

// In-memory token cache (Edge runtime — survives across requests within a deployment)
let cachedToken: { access_token: string; expires_at: number } | null = null;

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

async function fetchToken(): Promise<{ access_token: string; expires_at: number } | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
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
    return NextResponse.json({ error: "Failed to obtain OpenSky token", authenticated: false }, { status: 503 });
  }

  cachedToken = result;

  return NextResponse.json({
    token: result.access_token,
    expires_at: result.expires_at,
    cached: false,
  });
}
