import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for /api/tiles/WMTSCapabilities.xml — the OGC WMTS 1.0.0 capabilities
 * document.
 *
 * The route is self-contained (no storage or outbound fetch), so the suite
 * pins the XML shape a WMTS client relies on: namespace declarations, the
 * elevation layer, per-CRS tile matrix sets, and origin-scoped URLs.
 */

import { GET } from "@/app/api/tiles/[tileMatrixSetId]/route";

async function getDoc(origin: string): Promise<{ resp: Response; xml: string }> {
  // The literal /api/tiles/WMTSCapabilities.xml segment is shadowed by this
  // dynamic route, so the document is served through it.
  const resp = await GET(new NextRequest(`${origin}/api/tiles/WMTSCapabilities.xml`), {
    params: Promise.resolve({ tileMatrixSetId: "WMTSCapabilities.xml" }),
  });
  return { resp, xml: await resp.text() };
}

/** The <TileMatrixSet> block for one advertised set id. */
function tmsBlock(xml: string, id: string): string {
  const marker = `<ows:Identifier>${id}</ows:Identifier>`;
  const start = xml.indexOf(marker);
  const blockStart = xml.lastIndexOf("<TileMatrixSet>", start);
  const blockEnd = xml.indexOf("</TileMatrixSet>", start);
  return xml.slice(blockStart, blockEnd + "</TileMatrixSet>".length);
}

describe("WMTS 1.0.0 capabilities document (/api/tiles/WMTSCapabilities.xml)", () => {
  it("serves XML with cache and CORS headers", async () => {
    const { resp, xml } = await getDoc("https://tiles.example.com");
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/xml");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it("declares the WMTS and OWS namespaces the document body uses", async () => {
    const { xml } = await getDoc("https://tiles.example.com");
    expect(xml).toContain('xmlns="http://www.opengis.net/wmts/1.0"');
    expect(xml).toContain('xmlns:ows="http://www.opengis.net/ows/1.1"');
    expect(xml).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(xml).toContain('version="1.0.0"');
  });

  it("advertises the Terrarium elevation layer over both served tile matrix sets", async () => {
    const { xml } = await getDoc("https://tiles.example.com");
    expect(xml).toContain("<ows:Identifier>elevation-terrarium</ows:Identifier>");
    expect(xml).toContain("<Format>image/png</Format>");
    expect(xml).toContain("<TileMatrixSet>WebMercatorQuad</TileMatrixSet>");
    // #122: WorldCRS84Quad is served conformantly again — true EPSG:4326
    // assembly in lib/tile-crs84.ts, no relabelled 3857 bytes.
    expect(xml).toContain("<TileMatrixSet>WorldCRS84Quad</TileMatrixSet>");
  });

  it("builds per-set GetTile ResourceURL templates from the request origin", async () => {
    const { xml } = await getDoc("https://tiles.example.com");
    // One template per advertised set on the single shared layer
    expect(xml.match(/<ResourceURL /g) ?? []).toHaveLength(2);
    expect(xml).toContain(
      'template="https://tiles.example.com/api/dem-tile/{TileMatrix}/{TileCol}/{TileRow}"',
    );
    // CRS84 serves through its own OGC API - Tiles path, in WMTS coordinate
    // order {TileMatrix}/{TileRow}/{TileCol}
    expect(xml).toContain(
      'template="https://tiles.example.com/api/tiles/WorldCRS84Quad/{TileMatrix}/{TileRow}/{TileCol}"',
    );
  });

  it("links its own GetCapabilities and ServiceMetadataURL back to this endpoint", async () => {
    const { xml } = await getDoc("https://tiles.example.com");
    const selfLinks = xml.match(/WMTSCapabilities\.xml/g) ?? [];
    expect(selfLinks.length).toBeGreaterThanOrEqual(2);
    expect(xml).toContain('xlink:href="https://tiles.example.com/api/tiles/WMTSCapabilities.xml"');
  });

  it("defines 13 tile matrices per set with the correct scale progression", async () => {
    const { xml } = await getDoc("https://tiles.example.com");
    // z0-z12 for each of the two advertised sets
    expect((xml.match(/<TileMatrix>/g) ?? []).length).toBe(26);
    // Level 0 scale per the GoogleMapsCompatible well-known scale set
    // (shared by WorldCRS84Quad per OGC 17-083r2), halving per level
    expect(xml).toContain("<ScaleDenominator>559082264.0287178</ScaleDenominator>");
    expect(xml).toContain("<ScaleDenominator>279541132.0143589</ScaleDenominator>");
    expect(xml).toContain("<ScaleDenominator>136494.69336638617</ScaleDenominator>"); // z12
    // Deepest matrix sizes: WebMercatorQuad 4096x4096, WorldCRS84Quad 8192x4096
    expect(xml).toContain("<MatrixWidth>4096</MatrixWidth>");
    expect(xml).toContain("<MatrixHeight>4096</MatrixHeight>");
    expect(xml).toContain("<MatrixWidth>8192</MatrixWidth>");
    expect(xml).toContain("<TileWidth>256</TileWidth>");
    expect(xml).toContain("<TileHeight>256</TileHeight>");
  });

  it("uses each set's own TopLeftCorner in its native CRS units", async () => {
    const { xml } = await getDoc("https://tiles.example.com");
    expect(xml).toContain("<TopLeftCorner>-20037508.34278925 20037508.34278925</TopLeftCorner>");
    // The geographic corner belongs to the conformant WorldCRS84Quad set
    expect(tmsBlock(xml, "WorldCRS84Quad")).toContain("<TopLeftCorner>-180 90</TopLeftCorner>");
  });

  it("declares WorldCRS84Quad per the OGC 17-083r2 definition", async () => {
    const { xml } = await getDoc("https://tiles.example.com");
    const block = tmsBlock(xml, "WorldCRS84Quad");
    expect(block).toContain("<ows:SupportedCRS>urn:ogc:def:crs:OGC:1.3:CRS84</ows:SupportedCRS>");
    expect(block).toContain(
      "<WellKnownScaleSet>http://www.opengis.net/def/wkss/OGC/1.0/WorldCRS84Quad</WellKnownScaleSet>",
    );
    // 2x1 root matrix spanning -180..180 / 90..-90
    expect(block).toContain("<MatrixWidth>2</MatrixWidth>");
    expect(block).toContain("<MatrixHeight>1</MatrixHeight>");
  });

  it("embeds the request origin verbatim in every URL", async () => {
    // URL.origin is already normalized, so no raw XML can enter the document
    const { xml } = await getDoc("https://TILES.Example.com:8443");
    expect(xml).toContain('xlink:href="https://tiles.example.com:8443/api/tiles/WMTSCapabilities.xml"');
    expect(xml).toContain('template="https://tiles.example.com:8443/api/dem-tile/{TileMatrix}/{TileCol}/{TileRow}"');
  });
});
