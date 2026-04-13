import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

function tileParams(z: string, row: string, col: string, setId = "WebMercatorQuad") {
  return {
    params: Promise.resolve({ tileMatrixSetId: setId, tileMatrix: z, tileRow: row, tileCol: col }),
  };
}

describe("OGC Tile Data API", () => {
  it("returns 400 for unknown tile matrix set", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/[tileMatrix]/[tileRow]/[tileCol]/route");
    const resp = await GET(mockRequest("/api/tiles/BadSet/0/0/0"), tileParams("0", "0", "0", "BadSet"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.code).toBe("InvalidParameterValue");
  });

  it("returns 400 for invalid zoom level", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/[tileMatrix]/[tileRow]/[tileCol]/route");
    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad/abc/0/0"), tileParams("abc", "0", "0"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.code).toBe("InvalidParameterValue");
  });

  it("returns 400 for zoom level out of range", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/[tileMatrix]/[tileRow]/[tileCol]/route");
    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad/15/0/0"), tileParams("15", "0", "0"));
    expect(resp.status).toBe(400);
  });

  it("returns 404 for tile coordinates out of range", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/[tileMatrix]/[tileRow]/[tileCol]/route");
    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad/0/5/5"), tileParams("0", "5", "5"));
    expect(resp.status).toBe(404);
    const data = await resp.json();
    expect(data.code).toBe("TileOutOfRange");
  });

  it("returns PNG image for valid tile (or ocean fallback)", async () => {
    const { GET } = await import("@/app/api/tiles/[tileMatrixSetId]/[tileMatrix]/[tileRow]/[tileCol]/route");
    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad/0/0/0"), tileParams("0", "0", "0"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBeTruthy();
  });

  it("OPTIONS returns CORS headers", async () => {
    const { OPTIONS } = await import("@/app/api/tiles/[tileMatrixSetId]/[tileMatrix]/[tileRow]/[tileCol]/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
