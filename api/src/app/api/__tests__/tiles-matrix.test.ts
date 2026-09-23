import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("Tile Matrix Set API", () => {
  it("returns WebMercatorQuad metadata", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/route");
    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad"), {
      params: Promise.resolve({ tileMatrixSetId: "WebMercatorQuad" }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.id).toBe("WebMercatorQuad");
    expect(data.title).toBe("Google Web Mercator");
    expect(data.crs).toContain("3857");
    expect(data.tileMatrices).toHaveLength(15); // z0-z14
    expect(data.tileMatrices[0].id).toBe("0");
    expect(data.tileMatrices[14].id).toBe("14");
    expect(data.tileMatrices[0].scaleDenominator).toBeCloseTo(559082264.0287178, 4);
    expect(data.links).toBeTruthy();
  });

  it("returns WorldCRS84Quad metadata per the OGC 17-083r2 definition", async () => {
    // #122: true EPSG:4326 assembly exists in lib/tile-crs84.ts, so the
    // geographic set is served conformantly again.
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/route");
    const resp = await GET(mockRequest("/api/tiles/WorldCRS84Quad"), {
      params: Promise.resolve({ tileMatrixSetId: "WorldCRS84Quad" }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.id).toBe("WorldCRS84Quad");
    expect(data.crs).toBe("http://www.opengis.net/def/crs/OGC/1.3/CRS84");
    expect(data.wellKnownScaleSet).toBe("http://www.opengis.net/def/wkss/OGC/1.0/WorldCRS84Quad");
    expect(data.tileMatrices).toHaveLength(15); // z0-z14
    expect(data.tileMatrices[0].pointOfOrigin).toEqual({ x: -180, y: 90 });
    // Root matrix is 2x1; each level doubles both dimensions
    expect(data.tileMatrices[0].matrixWidth).toBe(2);
    expect(data.tileMatrices[0].matrixHeight).toBe(1);
    expect(data.tileMatrices[14].matrixWidth).toBe(2 ** 15);
    expect(data.tileMatrices[14].matrixHeight).toBe(2 ** 14);
    // Level-0 pixel spans 0.703125deg (half the Mercator pixel's degrees),
    // so the denominator is half GoogleMapsCompatible's — GDAL derives
    // resolution from this number and mis-reads the set if it is doubled.
    expect(data.tileMatrices[0].scaleDenominator).toBeCloseTo(279541132.0143589, 4);
  });

  it("returns 400 for unknown tile matrix set", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/route");
    const resp = await GET(mockRequest("/api/tiles/UnknownSet"), {
      params: Promise.resolve({ tileMatrixSetId: "UnknownSet" }),
    });
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.code).toBe("InvalidParameterValue");
  });

  it("serves the WMTS capabilities document through the shadowed literal path", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/route");
    const resp = await GET(mockRequest("/api/tiles/WMTSCapabilities.xml"), {
      params: Promise.resolve({ tileMatrixSetId: "WMTSCapabilities.xml" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("xml");
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/tiles/[tileMatrixSetId]/route");
    // This handler returns the preflight Response directly (no Promise wrapper).
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
