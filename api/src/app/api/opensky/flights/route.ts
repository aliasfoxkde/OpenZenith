import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";

export const runtime = "edge";

const OPENSKY_API = "https://opensky-network.org/api/states/all";
const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

// In-memory token cache
let cachedToken: { access_token: string; expires_at: number } | null = null;

// Simple credit tracker (resets on deployment cold start — adequate for a demo)
const CREDIT_BUDGET = 4000;
let creditsUsed = 0;
let creditResetDate = new Date().toDateString();

function checkCreditBudget(): boolean {
  const today = new Date().toDateString();
  if (today !== creditResetDate) {
    creditsUsed = 0;
    creditResetDate = today;
  }
  return creditsUsed < CREDIT_BUDGET;
}

function estimateCreditCost(bboxDeg: number): number {
  if (bboxDeg < 25) return 1;
  if (bboxDeg < 100) return 2;
  if (bboxDeg < 400) return 3;
  return 4;
}

async function getToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return cachedToken.access_token;
  }

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
    const data = await resp.json() as { access_token: string; expires_in: number };
    cachedToken = { access_token: data.access_token, expires_at: Date.now() + (data.expires_in - 300) * 1000 };
    return data.access_token;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Bounding box params (optional — falls back to global if not provided)
  const lamin = searchParams.get("lamin");
  const lamax = searchParams.get("lamax");
  const lomin = searchParams.get("lomin");
  const lomax = searchParams.get("lomax");

  // Estimate credit cost
  let bboxDeg = Infinity;
  if (lamin && lamax && lomin && lomax) {
    bboxDeg = (+lamax - +lamin) * (+lomax - +lomin);
  }
  const creditCost = estimateCreditCost(bboxDeg);

  if (!checkCreditBudget()) {
    return NextResponse.json(
      { error: "Daily credit budget exhausted", credits_used: creditsUsed, budget: CREDIT_BUDGET },
      { status: 429 },
    );
  }

  // Try authenticated request first
  const token = await getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = new URL(OPENSKY_API);
  if (lamin && lamax && lomin && lomax) {
    url.searchParams.set("lamin", lamin);
    url.searchParams.set("lamax", lamax);
    url.searchParams.set("lomin", lomin);
    url.searchParams.set("lomax", lomax);
  }

  try {
    const resp = await cachedFetch(url.toString(), CACHE_TTL.FLIGHTS, {
      signal: AbortSignal.timeout(20000),
      headers,
    });

    if (!resp.ok) {
      // If authenticated request fails (401/403), clear token cache and return error
      if (resp.status === 401 || resp.status === 403) {
        cachedToken = null;
      }
      return NextResponse.json(
        { error: `OpenSky API returned ${resp.status}`, authenticated: !!token },
        { status: resp.status },
      );
    }

    const data = await resp.json();
    creditsUsed += creditCost;

    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Cache-Control", "public, max-age=10");
    responseHeaders.set("Content-Type", "application/json");
    responseHeaders.set("X-Credits-Used", String(creditsUsed));
    responseHeaders.set("X-Credits-Remaining", String(CREDIT_BUDGET - creditsUsed));
    responseHeaders.set("X-Authenticated", String(!!token));

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Flight data fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
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
