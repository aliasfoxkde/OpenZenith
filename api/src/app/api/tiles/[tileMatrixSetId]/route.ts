import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { wmtsCapabilitiesResponse } from "../wmts-capabilities";

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * OGC API - Tiles metadata for a specific tile matrix set.
 *
 * Returns tile matrix set definition with zoom levels and tile size.
 *
 * Also serves the WMTS 1.0.0 capabilities document: a literal route segment
 * for /api/tiles/WMTSCapabilities.xml is shadowed by this dynamic segment,
 * so the capabilities path is handled here instead.
 */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tileMatrixSetId: string }> }) {
  const baseUrl = new URL(request.url).origin;
  const { tileMatrixSetId } = await params;

  if (tileMatrixSetId === "WMTSCapabilities.xml") {
    return wmtsCapabilitiesResponse(request);
  }

  // Only WebMercatorQuad is advertised: the served tiles are EPSG:3857 and
  // there is no EPSG:4326 resampling, so a WorldCRS84Quad advertisement
  // would describe tiles we cannot serve conformantly (its official root
  // matrix is 2x1, and the data would need reprojection).
  const validSets = ["WebMercatorQuad"];
  if (!validSets.includes(tileMatrixSetId)) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: `Unknown tileMatrixSet: ${tileMatrixSetId}` },
      { status: 400 },
    );
  }

  const maxZoom = 14;
  const tileWidth = 256;
  const tileHeight = 256;
  const wellKnownScaleSet = "http://www.opengis.net/def/wkss/OGC/1.0/GoogleMapsCompatible";

  const tileMatrices = [];
  for (let z = 0; z <= maxZoom; z++) {
    tileMatrices.push({
      id: String(z),
      title: `Zoom level ${z}`,
      scaleDenominator: 559082264.0287178 / Math.pow(2, z),
      pointOfOrigin: { x: -20037508.3427892, y: 20037508.3427892 },
      tileWidth,
      tileHeight,
      matrixWidth: Math.pow(2, z),
      matrixHeight: Math.pow(2, z),
    });
  }

  return NextResponse.json(
    {
      id: tileMatrixSetId,
      title: "Google Web Mercator",
      crs: "http://www.opengis.net/def/crs/EPSG/0/3857",
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
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
      },
    },
  );
}
