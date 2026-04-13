import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * OGC API - Tiles landing page.
 *
 * Returns available tile matrix sets with links to their definitions
 * and tile data following OGC API - Tiles 1.0 specification.
 */
export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;

  return NextResponse.json(
    {
      title: "OpenZenith OGC API - Tiles",
      description: "Global elevation tiles in Terrarium PNG encoding (Copernicus GLO-30 + GEBCO 2025)",
      links: [
        {
          rel: "self",
          type: "application/json",
          href: `${baseUrl}/api/tiles`,
        },
        {
          rel: "root",
          type: "application/json",
          href: `${baseUrl}/api`,
        },
        {
          rel: "tileMatrixSets",
          type: "application/json",
          href: `${baseUrl}/api/tiles/WebMercatorQuad`,
          title: "Google Web Mercator (EPSG:3857)",
        },
        {
          rel: "tileMatrixSets",
          type: "application/json",
          href: `${baseUrl}/api/tiles/WorldCRS84Quad`,
          title: "WGS 84 (EPSG:4326)",
        },
        {
          rel: "service-desc",
          type: "application/vnd.oai.openapi+json;version=3.0",
          href: `${baseUrl}/api/openapi.json`,
          title: "OpenAPI 3.0 service description",
        },
      ],
      tileMatrixSetLinks: [
        {
          tileMatrixSet: "WebMercatorQuad",
          href: `${baseUrl}/api/tiles/WebMercatorQuad`,
        },
        {
          tileMatrixSet: "WorldCRS84Quad",
          href: `${baseUrl}/api/tiles/WorldCRS84Quad`,
        },
      ],
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
      },
    },
  );
}
