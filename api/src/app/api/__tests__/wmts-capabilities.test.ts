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
    expect(xml).toContain("<ows:Identifier>elevation-terrarium-WorldCRS84Quad</ows:Identifier>");
    expect(xml).toContain("<Format>image/png</Format>");
    expect(xml).toContain("<TileMatrixSet>WebMercatorQuad</TileMatrixSet>");
    // #122: WorldCRS84Quad is served conformantly again — true EPSG:4326
    // assembly in lib/tile-crs84.ts, no relabelled 3857 bytes.
    expect(xml).toContain("<TileMatrixSet>WorldCRS84Quad</TileMatrixSet>");
    // One Layer per set: a ResourceURL carries no tileMatrixSet attribute,
    // so merging both sets into one layer leaves clients guessing which
    // template belongs to which set (GDAL guesses wrong).
    expect((xml.match(/<Layer>/g) ?? []).length).toBe(2);
  });

  it("pairs each Layer with exactly its own set link and ResourceURL template", async () => {
    const { xml } = await getDoc("https://tiles.example.com");
    // Layer identifiers are unique and each Layer block contains exactly one
    // TileMatrixSetLink and one ResourceURL, so no client-side pairing guess
    // is possible.
    const layerBlocks = xml.split("<Layer>").slice(1).map((chunk) => chunk.split("</Layer>")[0]);
    expect(layerBlocks).toHaveLength(2);
    const merc = layerBlocks.find((b) => b.includes("<ows:Identifier>elevation-terrarium</ows:Identifier>"));
    const crs84 = layerBlocks.find((b) =>
      b.includes("<ows:Identifier>elevation-terrarium-WorldCRS84Quad</ows:Identifier>"),
    );
    if (!merc || !crs84) throw new Error("expected one Layer block per advertised set");
    expect((merc.match(/<TileMatrixSetLink>/g) ?? []).length).toBe(1);
    expect((merc.match(/<ResourceURL /g) ?? []).length).toBe(1);
    expect((crs84.match(/<TileMatrixSetLink>/g) ?? []).length).toBe(1);
    expect((crs84.match(/<ResourceURL /g) ?? []).length).toBe(1);
    expect(merc).toContain("<TileMatrixSet>WebMercatorQuad</TileMatrixSet>");
    expect(merc).toContain(
      'template="https://tiles.example.com/api/dem-tile/{TileMatrix}/{TileCol}/{TileRow}"',
    );
    // CRS84 serves through its own OGC API - Tiles path, in WMTS coordinate
    // order {TileMatrix}/{TileRow}/{TileCol}
    expect(crs84).toContain("<TileMatrixSet>WorldCRS84Quad</TileMatrixSet>");
    expect(crs84).toContain(
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
    // Level 0 scale per each set's own well-known scale set, halving per
    // level. WorldCRS84Quad's 2x1 root gives its level-0 pixel half the
    // Mercator degrees, so its denominator is half — asserting per set,
    // since a whole-document toContain would pass on the Mercator set's
    // z1 matrix alone (559082264.0287178 / 2 is exactly Mercator level 1).
    const merc = tmsBlock(xml, "WebMercatorQuad");
    const crs84 = tmsBlock(xml, "WorldCRS84Quad");
    expect(merc).toContain("<ScaleDenominator>559082264.0287178</ScaleDenominator>");
    expect(crs84).toContain("<ScaleDenominator>279541132.0143589</ScaleDenominator>");
    expect(merc).toContain("<ScaleDenominator>136494.69336638617</ScaleDenominator>"); // z12
    expect(crs84).toContain("<ScaleDenominator>68247.34668319309</ScaleDenominator>"); // z12
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
