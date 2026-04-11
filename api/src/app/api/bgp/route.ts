import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const NLNOG_LG = "https://lg.ring.nlnog.net/api";

export async function GET(request: NextRequest) {
  const prefix = request.nextUrl.searchParams.get("prefix");
  if (!prefix) {
    return NextResponse.json({ error: "Missing required parameter: prefix (e.g. 8.8.8.0/24)" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(`${NLNOG_LG}/prefix?q=${encodeURIComponent(prefix)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "OpenZenith/1.0" },
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      return NextResponse.json({ error: `NLNOG Looking Glass returned ${resp.status}` }, { status: 502 });
    }

    const data = await resp.json();

    return NextResponse.json(
      { prefix, data },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to query BGP data";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
