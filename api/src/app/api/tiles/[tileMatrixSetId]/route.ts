import { NextRequest, NextResponse } from "next/server";
import { corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * OGC API - Tiles metadata for a specific tile matrix set.
 *
 * Returns tile matrix set definition with zoom levels and tile size.
 */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tileMatrixSetId: string }> }) {
  const baseUrl = new URL(request.url).origin;
  const { tileMatrixSetId } = await params;

  const validSets = ["WebMercatorQuad", "WorldCRS84Quad"];
  if (!validSets.includes(tileMatrixSetId)) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: `Unknown tileMatrixSet: ${tileMatrixSetId}` },
      { status: 400 },
    );
  }

  const maxZoom = 14;
  const tileWidth = 256;
  const tileHeight = 256;
  const wellKnownScaleSet =
    tileMatrixSetId === "WebMercatorQuad"
      ? "http://www.opengis.net/def/wkss/OGC/1.0/GoogleMapsCompatible"
      : "http://www.opengis.net/def/wkss/OGC/1.0/WorldCRS84Quad";

  const tileMatrices = [];
  for (let z = 0; z <= maxZoom; z++) {
    const matrixWidth = Math.pow(2, z);
    const matrixHeight = Math.pow(2, z);
    const scaleDenominator =
      tileMatrixSetId === "WebMercatorQuad" ? 559082264.0287178 / Math.pow(2, z) : 279541132.0143589 / Math.pow(2, z);
    tileMatrices.push({
      id: String(z),
      title: `Zoom level ${z}`,
      scaleDenominator,
      pointOfOrigin:
        tileMatrixSetId === "WebMercatorQuad" ? { x: -20037508.3427892, y: 20037508.3427892 } : { x: -180, y: 90 },
      tileWidth,
      tileHeight,
      matrixWidth,
      matrixHeight,
    });
  }

  return NextResponse.json(
    {
      id: tileMatrixSetId,
      title: tileMatrixSetId === "WebMercatorQuad" ? "Google Web Mercator" : "WGS 84",
      crs:
        tileMatrixSetId === "WebMercatorQuad"
          ? "http://www.opengis.net/def/crs/EPSG/0/3857"
          : "http://www.opengis.net/def/crs/EPSG/0/4326",
      wellKnownScaleSet,
      tileMatrices,
      links: [
        {
          rel: "self",
          type: "application/json",
          href: `${baseUrl}/api/tiles/${tileMatrixSetId}`,
        },
        {
          rel: "root",
          type: "application/json",
          href: `${baseUrl}/api/tiles`,
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
