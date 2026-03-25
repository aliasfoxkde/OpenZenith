import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const cf = (request as any).cf;

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
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
