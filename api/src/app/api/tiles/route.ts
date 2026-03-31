import { NextResponse } from "next/server";

export const runtime = "edge";

const BASE_URL = "https://openzenith.cyopsys.com";

/**
 * OGC API - Tiles landing page.
 *
 * Returns available tile matrix sets with links to their definitions
 * and tile data following OGC API - Tiles 1.0 specification.
 */
export async function GET() {
  return NextResponse.json(
    {
      title: "OpenZenith OGC API - Tiles",
      description: "Global elevation tiles in Terrarium PNG encoding (Copernicus GLO-30 + GEBCO 2025)",
      links: [
        {
          rel: "self",
          type: "application/json",
          href: `${BASE_URL}/api/tiles`,
        },
        {
          rel: "root",
          type: "application/json",
          href: `${BASE_URL}/api`,
        },
        {
          rel: "tileMatrixSets",
          type: "application/json",
          href: `${BASE_URL}/api/tiles/WebMercatorQuad`,
          title: "Google Web Mercator (EPSG:3857)",
        },
        {
          rel: "tileMatrixSets",
          type: "application/json",
          href: `${BASE_URL}/api/tiles/WorldCRS84Quad`,
          title: "WGS 84 (EPSG:4326)",
        },
        {
          rel: "service-desc",
          type: "application/vnd.oai.openapi+json;version=3.0",
          href: `${BASE_URL}/api/openapi.json`,
          title: "OpenAPI 3.0 service description",
        },
      ],
      tileMatrixSetLinks: [
        {
          tileMatrixSet: "WebMercatorQuad",
          href: `${BASE_URL}/api/tiles/WebMercatorQuad`,
        },
        {
          tileMatrixSet: "WorldCRS84Quad",
          href: `${BASE_URL}/api/tiles/WorldCRS84Quad`,
        },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    },
  );
}
