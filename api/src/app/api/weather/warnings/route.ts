import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS } from "@/lib/cors";

export const runtime = "edge";

export async function GET(_request: NextRequest) {
  try {
    const resp = await fetch("https://api.weather.gov/alerts/active", {
      signal: AbortSignal.timeout(10000),
      headers: {
        Accept: "application/json,*/*",
        "User-Agent": "OpenZenith/1.0",
      },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Weather API returned ${resp.status}` },
        { status: resp.status, headers: CORS_HEADERS },
      );
    }

    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502, headers: CORS_HEADERS });
  }
}
