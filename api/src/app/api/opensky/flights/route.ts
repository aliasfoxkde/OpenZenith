import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsError, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

const OPENSKY_API = "https://opensky-network.org/api/states/all";
const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

let cachedToken: { access_token: string; expires_at: number } | null = null;

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

function parseBboxCoord(val: string | null, min: number, max: number): number | null {
  if (!val) return null;
  const n = Number(val);
  return isNaN(n) || n < min || n > max ? null : n;
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
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: "grant_type=client_credentials",
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { access_token: string; expires_in: number };
    cachedToken = { access_token: data.access_token, expires_at: Date.now() + (data.expires_in - 300) * 1000 };
    return data.access_token;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Bounding box params (optional — falls back to global if not provided)
  const rawLamin = searchParams.get("lamin");
  const rawLamax = searchParams.get("lamax");
  const rawLomin = searchParams.get("lomin");
  const rawLomax = searchParams.get("lomax");

  const lamin = parseBboxCoord(rawLamin, -90, 90);
  const lamax = parseBboxCoord(rawLamax, -90, 90);
  const lomin = parseBboxCoord(rawLomin, -180, 180);
  const lomax = parseBboxCoord(rawLomax, -180, 180);

  const hasAny = [rawLamin, rawLamax, rawLomin, rawLomax].some((v) => v !== null);
  const allValid = lamin !== null && lamax !== null && lomin !== null && lomax !== null;
  if (hasAny && !allValid) {
    return corsError("Invalid bbox params: lamin, lamax (-90 to 90), lomin, lomax (-180 to 180) required", 400);
  }

  // Estimate credit cost
  let bboxDeg = Infinity;
  if (allValid) {
    bboxDeg = (lamax - lamin) * (lomax - lomin);
  }
  const creditCost = estimateCreditCost(bboxDeg);

  if (!checkCreditBudget()) {
    return Response.json(
      { error: "Daily credit budget exhausted", credits_used: creditsUsed, budget: CREDIT_BUDGET },
      { status: 429, headers: CORS_HEADERS },
    );
  }

  // Try authenticated request first
  const token = await getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = new URL(OPENSKY_API);
  if (allValid) {
    url.searchParams.set("lamin", String(lamin));
    url.searchParams.set("lamax", String(lamax));
    url.searchParams.set("lomin", String(lomin));
    url.searchParams.set("lomax", String(lomax));
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
      return Response.json(
        { error: `OpenSky API returned ${resp.status}`, authenticated: !!token },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    const data = await resp.json();
    creditsUsed += creditCost;

    const responseHeaders = new Headers(CORS_HEADERS);
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
    return NextResponse.json({ error: message }, { status: 200, headers: CORS_HEADERS });
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
