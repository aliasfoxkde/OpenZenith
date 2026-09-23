import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "./helpers";

vi.mock("@/lib/tile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tile")>();
  return { ...actual, getTileData: vi.fn(actual.getTileData) };
});

vi.mock("@/lib/tile-crs84", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tile-crs84")>();
  return { ...actual, getTileDataCRS84: vi.fn(actual.getTileDataCRS84) };
});

import { getTileData } from "@/lib/tile";
import { getTileDataCRS84 } from "@/lib/tile-crs84";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TILE_100M = { data: new Int16Array(256 * 256).fill(100), width: 256, height: 256, zoom: 4 };

function tileParams(z: string, row: string, col: string, setId = "WebMercatorQuad") {
  return {
    params: Promise.resolve({ tileMatrixSetId: setId, tileMatrix: z, tileRow: row, tileCol: col }),
  };
}

/** Reset the tile assembler seams to the real implementations between tests. */
let realGetTileData: typeof getTileData | undefined;
let realGetTileDataCRS84: typeof getTileDataCRS84 | undefined;
function resetTileDataMock() {
  const mocked = vi.mocked(getTileData);
  realGetTileData ??= mocked.getMockImplementation() as typeof getTileData;
  mocked.mockReset().mockImplementation(realGetTileData);
  const mockedCRS84 = vi.mocked(getTileDataCRS84);
  realGetTileDataCRS84 ??= mockedCRS84.getMockImplementation() as typeof getTileDataCRS84;
  mockedCRS84.mockReset().mockImplementation(realGetTileDataCRS84);
}
beforeEach(resetTileDataMock);
afterEach(() => {
  vi.restoreAllMocks();
});

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
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("OGC Tile Data API — coordinate validation and CRS axis handling", () => {
  const route = () => import("@/app/api/tiles/[tileMatrixSetId]/[tileMatrix]/[tileRow]/[tileCol]/route");

  it("returns 400 when the tile column is not numeric", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad/4/0/abc"), tileParams("4", "0", "abc"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.code).toBe("InvalidParameterValue");
    expect(data.description).toBe("Invalid tile coordinates");
  });

  it("returns 400 when the tile row is not numeric", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad/4/abc/0"), tileParams("4", "abc", "0"));
    expect(resp.status).toBe(400);
    expect((await resp.json()).description).toBe("Invalid tile coordinates");
  });

  it("returns 400 for negative tile coordinates before any range check", async () => {
    const { GET } = await route();
    const negativeRow = await GET(mockRequest("/api/tiles/WebMercatorQuad/4/0/-1"), tileParams("4", "-1", "0"));
    const negativeCol = await GET(mockRequest("/api/tiles/WebMercatorQuad/4/-1/0"), tileParams("4", "0", "-1"));
    expect(negativeRow.status).toBe(400);
    expect(negativeCol.status).toBe(400);
    expect((await negativeRow.json()).description).toBe("Invalid tile coordinates");
    expect((await negativeCol.json()).description).toBe("Invalid tile coordinates");
  });

  it("accepts the full coordinate range at the highest zoom (z=14, maxTile=16383)", async () => {
    vi.mocked(getTileData).mockResolvedValue(TILE_100M);
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad/14/16383/16383"), tileParams("14", "16383", "16383"));
    expect(resp.status).toBe(200);
    expect(vi.mocked(getTileData).mock.calls[0]).toEqual([14, 16383, 16383, expect.anything()]);
  });

  it("returns 404 one past the range at the highest zoom", async () => {
    const { GET } = await route();
    const resp = await GET(
      mockRequest("/api/tiles/WebMercatorQuad/14/16384/0"),
      tileParams("14", "0", "16384"),
    );
    expect(resp.status).toBe(404);
    const data = await resp.json();
    expect(data.code).toBe("TileOutOfRange");
    expect(data.description).toBe("Tile 14/16384/0 is out of range");
  });

  it("applies the 2x1 WorldCRS84Quad root matrix to range checks", async () => {
    vi.mocked(getTileDataCRS84).mockResolvedValue(TILE_100M);
    const { GET } = await route();
    // z0: 2 columns x 1 row — the east tile is valid
    const ok = await GET(mockRequest("/api/tiles/WorldCRS84Quad/0/0/1"), tileParams("0", "0", "1", "WorldCRS84Quad"));
    expect(ok.status).toBe(200);
    // col 2 is past matrixWidth
    const badCol = await GET(mockRequest("/api/tiles/WorldCRS84Quad/0/0/2"), tileParams("0", "0", "2", "WorldCRS84Quad"));
    expect(badCol.status).toBe(404);
    expect((await badCol.json()).code).toBe("TileOutOfRange");
    // row 1 is past matrixHeight
    const badRow = await GET(mockRequest("/api/tiles/WorldCRS84Quad/0/1/0"), tileParams("0", "1", "0", "WorldCRS84Quad"));
    expect(badRow.status).toBe(404);
    expect(vi.mocked(getTileDataCRS84)).toHaveBeenCalledTimes(1);
  });
});

describe("OGC Tile Data API — tile assembly and fallback", () => {
  const route = () => import("@/app/api/tiles/[tileMatrixSetId]/[tileMatrix]/[tileRow]/[tileCol]/route");

  it("serves an assembled PNG with terrarium encoding headers", async () => {
    vi.mocked(getTileData).mockResolvedValue(TILE_100M);
    const { GET } = await route();

    const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad/4/8/5"), tileParams("4", "5", "8"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600, s-maxage=2592000");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const body = new Uint8Array(await resp.arrayBuffer());
    expect(resp.headers.get("Content-Length")).toBe(String(body.byteLength));
    expect(body.slice(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it("passes the XYZ row through for WebMercatorQuad", async () => {
    vi.mocked(getTileData).mockResolvedValue(TILE_100M);
    const { GET } = await route();

    await GET(mockRequest("/api/tiles/WebMercatorQuad/3/6/2"), tileParams("3", "2", "6"));
    // z=3 → maxTile 7; no flip: row 2 requested as-is
    expect(vi.mocked(getTileData).mock.calls[0]).toEqual([3, 6, 2, expect.anything()]);
  });

  it("dispatches WorldCRS84Quad to the EPSG:4326 assembler", async () => {
    // #122: CRS84 tiles are assembled conformantly — per-pixel lat/lon
    // sampling in lib/tile-crs84.ts — rather than served with only a row
    // flip of the Mercator grid (which handed clients wrong geometry).
    vi.mocked(getTileDataCRS84).mockResolvedValue(TILE_100M);
    const { GET } = await route();

    const resp = await GET(
      mockRequest("/api/tiles/WorldCRS84Quad/3/6/2"),
      tileParams("3", "2", "6", "WorldCRS84Quad"),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    // (z, col, row, backend) — the route passes tileCol before tileRow
    expect(vi.mocked(getTileDataCRS84).mock.calls[0]).toEqual([3, 6, 2, expect.anything()]);
    expect(vi.mocked(getTileData)).not.toHaveBeenCalled();
  });

  it("returns an ocean PNG with status 200 when tile assembly fails", async () => {
    vi.mocked(getTileData).mockRejectedValue(new Error("chunk not found"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await route();

    try {
      const resp = await GET(mockRequest("/api/tiles/WebMercatorQuad/4/8/5"), tileParams("4", "5", "8"));
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toBe("image/png");
      expect(resp.headers.get("X-Dem-Tile-Source")).toBe("fallback-ocean");
      expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600, s-maxage=2592000");

      const ocean = new Uint8Array(await resp.arrayBuffer());
      expect(ocean.byteLength).toBeGreaterThan(0);
      expect(ocean.slice(0, 8)).toEqual(PNG_SIGNATURE);

      expect(errorSpy).toHaveBeenCalledWith("OGC Tiles assembly error: 4/8/5", expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
