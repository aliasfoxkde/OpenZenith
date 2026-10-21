import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

/** Marks the route for the Cloudflare edge runtime (Workers) instead of the Node.js server runtime. */
export const runtime = "edge";

/** Cloudflare request object (cf property). */
interface CfRequestProperties {
  ip?: string;
  city?: string;
  country?: string;
  countryName?: string;
  subdivision1Code?: string;
  subdivision1Name?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  continent?: string;
  asn?: number;
  asOrganization?: string;
  colo?: string;
}

// Preflight has nothing to await — stay promise-returning because callers await handlers.
/**
 * CORS preflight handler for the GeoIP endpoint: answers the browser's
 * OPTIONS probe with the allowed-origin headers and an empty body.
 */
export function OPTIONS() {
  return Promise.resolve(corsPreflightResponse());
}

// Reads only request headers — no I/O to await. It stays promise-returning
// because callers await handlers.
/**
 * GET handler for the caller's approximate geolocation.
 *
 * Reads the Cloudflare `cf` request properties — the client's IP, city,
 * country, subdivision, postal code, latitude/longitude, timezone, continent,
 * ASN and colo — and falls back to the `x-forwarded-for` header for the IP
 * when Cloudflare did not supply one. Fields Cloudflare did not provide are
 * returned as null; a legitimate 0 latitude or longitude is preserved.
 *
 * The response is publicly cached for 3600 seconds.
 */
export function GET(request: NextRequest) {
  const cf = (request as NextRequest & { cf?: CfRequestProperties }).cf;

  const response = NextResponse.json(
    {
      ip: cf?.ip || request.headers.get("x-forwarded-for") || "unknown",
      city: cf?.city || null,
      country: cf?.country || null,
      countryName: cf?.countryName || null,
      region: cf?.subdivision1Code || null,
      regionName: cf?.subdivision1Name || null,
      postalCode: cf?.postalCode || null,
      // ?? so a legitimate 0 coordinate (equator / prime meridian) survives;
      // every other field is a string where "" is genuinely absent.
      latitude: cf?.latitude ?? null,
      longitude: cf?.longitude ?? null,
      timezone: cf?.timezone || null,
      continent: cf?.continent || null,
      asn: cf?.asn || null,
      asOrganization: cf?.asOrganization || null,
      colo: cf?.colo || null,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600",
        ...CORS_HEADERS,
      },
    },
  );
  return Promise.resolve(response);
}
