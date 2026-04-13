import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

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

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  const cf = (request as NextRequest & { cf?: CfRequestProperties }).cf;

  return NextResponse.json(
    {
      ip: cf?.ip || request.headers.get("x-forwarded-for") || "unknown",
      city: cf?.city || null,
      country: cf?.country || null,
      countryName: cf?.countryName || null,
      region: cf?.subdivision1Code || null,
      regionName: cf?.subdivision1Name || null,
      postalCode: cf?.postalCode || null,
      latitude: cf?.latitude || null,
      longitude: cf?.longitude || null,
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
}
