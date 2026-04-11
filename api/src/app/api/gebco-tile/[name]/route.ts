import { NextRequest, NextResponse } from "next/server";

// Edge runtime — GEBCO COG files are on NAS (local dev only).
// Terrain tiles are served from R2 via /api/dem-tile/{z}/{x}/{y}.
// Elevation queries use /api/elevation with R2-backed terrarium tiles.
export const runtime = "edge";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  // Validate filename
  if (!/^gebco_2025_sub_ice_[a-z0-9_.-]+\.tif$/.test(name)) {
    return NextResponse.json({ error: "Invalid tile name" }, { status: 400, headers: CORS_HEADERS });
  }

  // In edge runtime, GEBCO COG files are not accessible.
  // Use /api/dem-tile/{z}/{x}/{y} for terrain tiles or /api/elevation for point queries.
  return NextResponse.json(
    {
      error:
        "GEBCO COG tiles require Node.js runtime (local dev only). Use /api/dem-tile/{z}/{x}/{y} for terrain tiles.",
    },
    { status: 501, headers: CORS_HEADERS },
  );
}
