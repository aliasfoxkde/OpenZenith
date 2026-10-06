import { NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * Volcanoes endpoint — proxies the Smithsonian GVP weekly-report RSS
 * (volcano.si.edu). The upstream sends no Access-Control-Allow-Origin, so
 * the map client cannot fetch it cross-origin (browser consoles showed the
 * request CORS-blocked on every toggle); server-side there is no CORS
 * restriction. Returns the raw XML; an unavailable upstream becomes a
 * silent 200 with an empty body, which the client parses as zero features.
 */
export async function GET() {
  const XML_HEADERS = { ...CORS_HEADERS, "Content-Type": "text/xml; charset=utf-8" };
  try {
    const res = await cachedFetch("https://volcano.si.edu/news/WeeklyVolcanoRSS.xml", CACHE_TTL.VOLCANOES, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/xml, text/xml, */*" },
    });

    if (!res.ok) {
      return new NextResponse("", { status: 200, headers: XML_HEADERS });
    }
    return new NextResponse(await res.text(), {
      status: 200,
      headers: { ...XML_HEADERS, "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new NextResponse("", { status: 200, headers: XML_HEADERS });
  }
}
