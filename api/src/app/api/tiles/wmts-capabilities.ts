import { CORS_HEADERS } from "@/lib/cors";

/**
 * OGC WMTS 1.0.0 Capabilities document.
 *
 * The URL name promises WMTS XML — clients (QGIS, CesiumJS
 * WebMapTileServiceImageryProvider, GDAL) fetch it expecting a parseable
 * capabilities document, so this endpoint serves a genuine one rather than
 * the JSON tiles landing page (which lives at /api/tiles).
 *
 * Advertises the Terrarium PNG elevation layer served by
 * /api/dem-tile/{z}/{x}/{y} over the two supported tile matrix sets.
 */

const WMTS_XSD =
  "http://www.opengis.net/wmts/1.0 http://schemas.opengis.net/wmts/1.0/wmtsGetCapabilities_response.xsd";

const MAX_MATRIX_LEVEL = 12; // matches the terrain provider's MAX_TERRAIN_ZOOM

// Scale denominators per OGC Well-Known Scale Set definitions for 256px
// tiles. WebMercatorQuad level 0 = 559082264.0287178; WorldCRS84Quad level 0
// = 279541132.01435894 (2x1 root matrix). Each level halves both.
const WEB_MERCATOR_L0_SCALE = 559082264.0287178;
const WORLD_CRS84_L0_SCALE = 279541132.01435894;

interface TileMatrixSetDef {
  id: string;
  supportedCrs: string;
  wellKnownScaleSet: string;
  // TopLeftCorner in the TMS's own CRS units
  topLeftCorner: string;
  level0ScaleDenominator: number;
  level0MatrixWidth: number;
  level0MatrixHeight: number;
}

const TILE_MATRIX_SETS: TileMatrixSetDef[] = [
  {
    id: "WebMercatorQuad",
    supportedCrs: "urn:ogc:def:crs:EPSG::3857",
    wellKnownScaleSet: "http://www.opengis.net/def/wkss/OGC/1.0/GoogleMapsCompatible",
    topLeftCorner: "-20037508.34278925 20037508.34278925",
    level0ScaleDenominator: WEB_MERCATOR_L0_SCALE,
    level0MatrixWidth: 1,
    level0MatrixHeight: 1,
  },
  {
    id: "WorldCRS84Quad",
    supportedCrs: "urn:ogc:def:crs:OGC:1.3:CRS84",
    wellKnownScaleSet: "http://www.opengis.net/def/wkss/OGC/1.0/WorldCRS84Quad",
    topLeftCorner: "-180 90",
    level0ScaleDenominator: WORLD_CRS84_L0_SCALE,
    level0MatrixWidth: 2,
    level0MatrixHeight: 1,
  },
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tileMatrixSetXml(tms: TileMatrixSetDef): string {
  const matrices: string[] = [];
  for (let level = 0; level <= MAX_MATRIX_LEVEL; level++) {
    const matrixWidth = tms.level0MatrixWidth * 2 ** level;
    const matrixHeight = tms.level0MatrixHeight * 2 ** level;
    const scaleDenominator = tms.level0ScaleDenominator / 2 ** level;
    matrices.push(
      [
        "    <TileMatrix>",
        `      <ows:Identifier>${level}</ows:Identifier>`,
        `      <ScaleDenominator>${scaleDenominator}</ScaleDenominator>`,
        `      <TopLeftCorner>${tms.topLeftCorner}</TopLeftCorner>`,
        `      <MatrixWidth>${matrixWidth}</MatrixWidth>`,
        `      <MatrixHeight>${matrixHeight}</MatrixHeight>`,
        "      <TileWidth>256</TileWidth>",
        "      <TileHeight>256</TileHeight>",
        "    </TileMatrix>",
      ].join("\n"),
    );
  }
  return [
    "  <TileMatrixSet>",
    `    <ows:Identifier>${tms.id}</ows:Identifier>`,
    `    <ows:SupportedCRS>${tms.supportedCrs}</ows:SupportedCRS>`,
    `    <WellKnownScaleSet>${tms.wellKnownScaleSet}</WellKnownScaleSet>`,
    matrices.join("\n"),
    "  </TileMatrixSet>",
  ].join("\n");
}

/**
 * Build the WMTS 1.0.0 capabilities response for a request origin.
 *
 * Lives in a plain module (not a route file) because the literal segment
 * route for /api/tiles/WMTSCapabilities.xml is shadowed by the dynamic
 * [tileMatrixSetId] route — the dynamic handler delegates here instead.
 */
export function wmtsCapabilitiesResponse(request: Request): Response {
  const baseUrl = new URL(request.url).origin;

  const layers = TILE_MATRIX_SETS.map((tms) =>
    [
      "    <Layer>",
      "      <ows:Title>OpenZenith Global Elevation (Terrarium PNG)</ows:Title>",
      "      <ows:Abstract>SRTM 30m / GEBCO 2025 elevation encoded as Terrarium PNG tiles.</ows:Abstract>",
      "      <ows:Identifier>elevation-terrarium</ows:Identifier>",
      '      <Style isDefault="true">',
      "        <ows:Identifier>default</ows:Identifier>",
      "      </Style>",
      "      <Format>image/png</Format>",
      "      <TileMatrixSetLink>",
      `        <TileMatrixSet>${tms.id}</TileMatrixSet>`,
      "      </TileMatrixSetLink>",
      `      <ResourceURL format="image/png" resourceType="tile" template="${baseUrl}/api/dem-tile/{TileMatrix}/{TileCol}/{TileRow}" />`,
      "    </Layer>",
    ].join("\n"),
  ).join("\n");

  const capabilitiesUrl = `${esc(baseUrl)}/api/tiles/WMTSCapabilities.xml`;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${WMTS_XSD}" version="1.0.0">`,
    "  <ows:ServiceIdentification>",
    "    <ows:Title>OpenZenith Tile Server</ows:Title>",
    "    <ows:ServiceType>OGC WMTS</ows:ServiceType>",
    "    <ows:ServiceTypeVersion>1.0.0</ows:ServiceTypeVersion>",
    "  </ows:ServiceIdentification>",
    "  <ows:OperationsMetadata>",
    '    <ows:Operation name="GetCapabilities">',
    "      <ows:DCP>",
    "        <ows:HTTP>",
    `          <ows:Get xlink:href="${capabilitiesUrl}" />`,
    "        </ows:HTTP>",
    "      </ows:DCP>",
    "    </ows:Operation>",
    "  </ows:OperationsMetadata>",
    "  <Contents>",
    layers,
    TILE_MATRIX_SETS.map(tileMatrixSetXml).join("\n"),
    "  </Contents>",
    `  <ServiceMetadataURL xlink:href="${capabilitiesUrl}" />`,
    "</Capabilities>",
    "",
  ].join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      ...CORS_HEADERS,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
