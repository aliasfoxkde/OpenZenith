import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { crs84MatrixSize } from "@/lib/tile-crs84";
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

const WEB_MERCATOR_L0_SCALE = 559082264.0287178;

interface AdvertisedSet {
  title: string;
  crs: string;
  wellKnownScaleSet: string;
  pointOfOrigin: { x: number; y: number };
  l0ScaleDenominator: number;
  matrixSize: (z: number) => { matrixWidth: number; matrixHeight: number };
}

// WorldCRS84Quad (OGC 17-083r2): 2x1 root matrix, top-left (-180, 90), same
// scale sequence as GoogleMapsCompatible. Served conformantly by
// lib/tile-crs84.ts (true lat/lon assembly, no relabelled 3857 bytes).
const ADVERTISED_SETS: Record<string, AdvertisedSet> = {
  WebMercatorQuad: {
    title: "Google Web Mercator",
    crs: "http://www.opengis.net/def/crs/EPSG/0/3857",
    wellKnownScaleSet: "http://www.opengis.net/def/wkss/OGC/1.0/GoogleMapsCompatible",
    pointOfOrigin: { x: -20037508.3427892, y: 20037508.3427892 },
    l0ScaleDenominator: WEB_MERCATOR_L0_SCALE,
    matrixSize: (z) => ({ matrixWidth: 2 ** z, matrixHeight: 2 ** z }),
  },
  WorldCRS84Quad: {
    title: "World CRS84 Quad (WGS 84 lat/lon)",
    crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
    wellKnownScaleSet: "http://www.opengis.net/def/wkss/OGC/1.0/WorldCRS84Quad",
    pointOfOrigin: { x: -180, y: 90 },
    l0ScaleDenominator: WEB_MERCATOR_L0_SCALE,
    matrixSize: crs84MatrixSize,
  },
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ tileMatrixSetId: string }> }) {
  const baseUrl = new URL(request.url).origin;
  const { tileMatrixSetId } = await params;

  if (tileMatrixSetId === "WMTSCapabilities.xml") {
    return wmtsCapabilitiesResponse(request);
  }

  // Record lookup claims every key exists; an unknown id is valid URL input,
  // so the failure path below is real and the cast is load-bearing.
  const set = ADVERTISED_SETS[tileMatrixSetId] as AdvertisedSet | undefined;
  if (!set) {
    return NextResponse.json(
      { code: "InvalidParameterValue", description: `Unknown tileMatrixSet: ${tileMatrixSetId}` },
      { status: 400 },
    );
  }

  const maxZoom = 14;
  const tileWidth = 256;
  const tileHeight = 256;

  const tileMatrices = [];
  for (let z = 0; z <= maxZoom; z++) {
    const { matrixWidth, matrixHeight } = set.matrixSize(z);
    tileMatrices.push({
      id: String(z),
      title: `Zoom level ${z}`,
      scaleDenominator: set.l0ScaleDenominator / Math.pow(2, z),
      pointOfOrigin: set.pointOfOrigin,
      tileWidth,
      tileHeight,
      matrixWidth,
      matrixHeight,
    });
  }

  return NextResponse.json(
    {
      id: tileMatrixSetId,
      title: set.title,
      crs: set.crs,
      wellKnownScaleSet: set.wellKnownScaleSet,
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
