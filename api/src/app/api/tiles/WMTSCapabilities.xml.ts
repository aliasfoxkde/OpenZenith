import { NextResponse } from "next/server";

export const runtime = "edge";

/**
 * OGC API - Tiles landing page.
 *
 * Returns the TileMatrixSetLinks and links to available tile collections.
 * Follows OGC API - Tiles 1.0 specification.
 */

const BASE_URL = "https://openzenith.cyopsys.com";

export async function GET() {
  const tileMatrixSets = [
    {
      id: "WebMercatorQuad",
      title: "Google Web Mercator (EPSG:3857)",
      crs: "http://www.opengis.net/def/crs/EPSG/0/3857",
      bboxCrs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      wellKnownScaleSet: "http://www.opengis.net/def/wkss/OGC/1.0/GoogleMapsCompatible",
    },
    {
      id: "WorldCRS84Quad",
      title: "WGS 84 (EPSG:4326)",
      crs: "http://www.opengis.net/def/crs/EPSG/0/4326",
      bboxCrs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      wellKnownScaleSet: "http://www.opengis.net/def/wkss/OGC/1.0/WorldCRS84Quad",
    },
  ];

  return NextResponse.json(
    {
      title: "OpenZenith Tile Server",
      description: "OGC API - Tiles service for OpenZenith geospatial data",
      links: [
        {
          rel: "self",
          type: "application/json",
          href: `${BASE_URL}/api/tiles`,
        },
        {
          rel: "data",
          type: "application/json",
          href: `${BASE_URL}/api/tiles/WebMercatorQuad`,
          title: "Web Mercator Quad",
        },
        {
          rel: "data",
          type: "application/json",
          href: `${BASE_URL}/api/tiles/WorldCRS84Quad`,
          title: "WGS 84 Quad",
        },
      ],
      tileMatrixSets: tileMatrixSets.map((tms) => ({
        id: tms.id,
        title: tms.title,
        crs: tms.crs,
        links: [
          {
            rel: "http://www.w3.org/ns/dx/ogc/api-tiles/tileMatrixSet",
            type: "application/json",
            href: `${BASE_URL}/api/tiles/${tms.id}`,
          },
        ],
      })),
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
