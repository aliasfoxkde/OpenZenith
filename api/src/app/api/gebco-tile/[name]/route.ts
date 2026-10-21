/**
 * GEBCO COG tile endpoint - local-dev only, always declines in edge runtime.
 *
 * GET /api/gebco-tile/{name} - validates the GEBCO 2025 sub-ice filename and
 * answers 400 for anything malformed; a well-formed name gets a guidance JSON
 * pointing at /api/dem-tile/{z}/{x}/{y} (terrain) or /api/elevation (points),
 * because the GEBCO COG files live on the NAS and are unreadable from a
 * Cloudflare Worker. No caching.
 */
import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

// Edge runtime — GEBCO COG files are on NAS (local dev only).
// Terrain tiles are served from HuggingFace via /api/dem-tile/{z}/{x}/{y}.
// Elevation queries use /api/elevation.
/** Marks the route for the Cloudflare edge runtime (Workers) instead of the Node.js server runtime. */
export const runtime = "edge";

/**
 * CORS preflight handler for the GEBCO tile endpoint: answers the browser's
 * OPTIONS probe with the allowed-origin headers and an empty body.
 */
export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * GET handler for the GEBCO 2025 sub-ice COG tiles.
 *
 * Reads the `name` route segment and validates it against the
 * `gebco_2025_sub_ice_<id>.tif` filename pattern, answering 400 for anything
 * malformed. The GEBCO COG files live on the NAS and are unreadable from a
 * Cloudflare Worker, so a well-formed name always returns 501 with guidance
 * to use `/api/dem-tile/{z}/{x}/{y}` for terrain tiles or `/api/elevation` for
 * point queries. Nothing is cached.
 */
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
    // 501: the edge runtime structurally cannot serve COGs — a dev-only
    // capability gap, not an upstream or client failure.
    { status: 501, headers: CORS_HEADERS },
  );
}
