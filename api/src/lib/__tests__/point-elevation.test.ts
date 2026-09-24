import { describe, it, expect, vi, beforeEach } from "vitest";
import { zlibSync } from "fflate";
import type { ChunkBackend } from "../storage/backend";
import { buildChunk, buildTerrariumPNG } from "./tile-fixtures";

// Chunk fixtures are 256x256 grids that are predictor-encoded and compressed on
// the fly, which is slow enough to trip the default 5s timeout under coverage.
vi.setConfig({ testTimeout: 30_000 });

/**
 * The global test setup mocks @/lib/storage/cache with only staleWhileRevalidate;
 * point-elevation needs the chunk cache pair, so provide a complete factory here.
 */
const cacheGetMock = vi.fn<(key: string) => Promise<ArrayBuffer | null>>();
const cachePutMock = vi.fn<(key: string, data: ArrayBuffer) => Promise<void>>();

vi.mock("@/lib/storage/cache", () => ({
  cacheGet: (key: string) => cacheGetMock(key),
  cachePut: (key: string, data: ArrayBuffer) => cachePutMock(key, data),
  staleWhileRevalidate: vi.fn(),
}));

import { getPointElevation } from "../point-elevation";

/* ─── synthetic SRTM chunk fixtures ─── */

/**
 * Predictor-encode and zlib-compress one stored chunk. Edge chunks are stored
 * as the full 256x256 square with zero-delta padding (the shared fixture in
 * ./tile-fixtures encodes them that way), so the decoder's predictor runs at
 * stride 256 for every chunk.
 */
function chunkOf(elevationAt: (row: number, col: number) => number, chunkRow: number, chunkCol: number): ArrayBuffer {
  return buildChunk(elevationAt, chunkRow, chunkCol);
}

type ChunkTable = Map<string, ArrayBuffer>;

function buildChunks(build: (row: number, col: number) => ((r: number, c: number) => number) | null): ChunkTable {
  const table: ChunkTable = new Map();
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const elevationAt = build(row, col);
      if (!elevationAt) continue;
      table.set(`${row}:${col}`, chunkOf(elevationAt, row, col));
    }
  }
  return table;
}

/** Property (not method) shape so tests can assert on the mock without unbinding it. */
type FetchChunkMock = (srtmName: string, row: number, col: number) => Promise<ArrayBuffer>;

function backendFor(chunks: ChunkTable): Omit<ChunkBackend, "fetchChunk"> & { fetchChunk: FetchChunkMock } {
  return {
    fetchChunk: vi.fn((srtmName: string, row: number, col: number): Promise<ArrayBuffer> => {
      const chunk = chunks.get(`${row}:${col}`);
      if (!chunk) return Promise.reject(new Error(`no fixture chunk ${srtmName} ${row}:${col}`));
      return Promise.resolve(chunk);
    }),
  };
}

/* ─── synthetic terrarium PNG fixture (for the AWS fallback path) ─── */

function be32(value: number): Array<number> {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function pngChunk(type: string, data: Array<number>): Array<number> {
  const len = be32(data.length);
  const body = [...type.split("").map((ch) => ch.charCodeAt(0)), ...data];
  // CRC is not verified by the decoder under test
  return [...len, ...body, 0, 0, 0, 0];
}

function terrariumPng(
  size: number,
  sample: (x: number, y: number) => [number, number, number],
): ArrayBuffer {
  const scanlines: number[] = [];
  for (let y = 0; y < size; y++) {
    scanlines.push(0); // PNG filter type 0 (None)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = sample(x, y);
      scanlines.push(r, g, b);
    }
  }
  const idat = zlibSync(new Uint8Array(scanlines));
  const ihdr = [...be32(size), ...be32(size), 8, 2, 0, 0, 0];
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", ihdr),
    ...pngChunk("IDAT", [...idat]),
    ...pngChunk("IEND", []),
  ];
  return new Uint8Array(bytes).buffer;
}

beforeEach(() => {
  cacheGetMock.mockReset().mockResolvedValue(null);
  cachePutMock.mockReset().mockResolvedValue(undefined);
  vi.unstubAllGlobals();
});

/* ─── tests ─── */

describe("getPointElevation — SRTM chunk path", () => {
  it("returns null outside SRTM coverage without touching the backend", async () => {
    // No chunk fixtures needed: the points are outside coverage, so nothing
    // is ever fetched (building 225 chunks here was pure fixture waste).
    const storage = backendFor(new Map());

    expect(await getPointElevation(70, 0, storage)).toBeNull();
    expect(await getPointElevation(-70, 0, storage)).toBeNull();
    expect(storage.fetchChunk).not.toHaveBeenCalled();
  });

  it("decodes a chunk with horizontal differencing and reports the tile", async () => {
    // value = 100 + row + col keeps every delta non-trivial
    const storage = backendFor(buildChunks((row, col) => (r, c) => 100 + row * 256 + r + (col * 256 + c)));

    const result = await getPointElevation(41.95, -73.95, storage);

    // pixel (180,180) of chunk (0,0) in N41W073 -> 100 + 180 + 180
    expect(result).toEqual({
      elevation: 460,
      surfaceType: "land",
      source: "srtm",
      tile: "N41W073",
    });
    expect(storage.fetchChunk).toHaveBeenCalledWith("N41W073.tif", 0, 0);
  });

  it("returns a constant elevation for a flat chunk", async () => {
    // Each suite below queries a distinct lon (distinct oz:chunk key) so the
    // tests cannot cross-contaminate through any shared cache layer.
    const storage = backendFor(buildChunks(() => () => 500));

    const result = await getPointElevation(41.95, -73.94, storage);
    expect(result?.elevation).toBe(500);
    expect(result?.source).toBe("srtm");
  });

  it("caches fetched chunks under the oz:chunk key", async () => {
    const storage = backendFor(buildChunks(() => () => 500));

    await getPointElevation(41.95, -73.93, storage);

    expect(cachePutMock).toHaveBeenCalledTimes(1);
    expect(cachePutMock.mock.calls[0][0]).toBe("oz:chunk:N41W073.tif:0:0");
    expect(cachePutMock.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
  });

  it("serves a cached chunk without hitting the backend", async () => {
    const storage = backendFor(buildChunks(() => () => 500));
    const cached = chunkOf(() => 777, 0, 0);
    cacheGetMock.mockResolvedValue(cached);

    const result = await getPointElevation(41.95, -73.92, storage);

    expect(result?.elevation).toBe(777);
    expect(storage.fetchChunk).not.toHaveBeenCalled();
    expect(cachePutMock).not.toHaveBeenCalled();
  });

  it("reads the 17px remainder chunk at the south-east corner of a tile", async () => {
    // lat 41 / lon -73 is the last pixel of N41W073 -> chunk (14,14) holds
    // only 17 real pixel rows/columns (stored 256x256 with zero padding).
    const storage = backendFor(buildChunks((row, col) => (r, c) => 100 + row * 17 + r + (col * 17 + c)));

    const result = await getPointElevation(41.0, -73.0, storage);

    // local pixel (16,16) -> 100 + 14*17 + 16 + 14*17 + 16 = 608
    expect(result).toEqual({ elevation: 608, surfaceType: "land", source: "srtm", tile: "N41W073" });
    expect(storage.fetchChunk).toHaveBeenCalledWith("N41W073.tif", 14, 14);
  });

  it("samples the padded 15th chunk column without row misalignment", async () => {
    // Regression (production -6385m stripes): lon -73.002 lands in the last
    // 17 pixel columns of N41W073 (chunk col 14). The stored chunk is 256x256
    // with zero-delta padding; decoding at the stored stride is what keeps the
    // predictor aligned. The per-column ramp fails loudly if any row is read
    // at the wrong width.
    const storage = backendFor(buildChunks((row, col) => (r, c) => 100 + row + col * 10 + r * 2 + c * 3));

    // pixel col 3593 -> chunk (7,14), local pixel (8, 9)
    const result = await getPointElevation(41.5, -73.002, storage);

    // 100 + 7 + 14*10 + 8*2 + 9*3 = 290
    expect(result?.elevation).toBe(290);
    expect(result?.tile).toBe("N41W073");
    expect(storage.fetchChunk).toHaveBeenCalledWith("N41W073.tif", 7, 14);
  });

  it("returns null when the target pixel is SRTM nodata", async () => {
    const storage = backendFor(buildChunks(() => () => -32768));

    expect(await getPointElevation(41.95, -73.91, storage)).toBeNull();
  });

  it("returns null when the backend cannot fetch the chunk", async () => {
    const storage: ChunkBackend = {
      fetchChunk: vi.fn(() => Promise.reject(new Error("chunk not found"))),
    };

    expect(await getPointElevation(41.95, -73.90, storage)).toBeNull();
  });

  it("returns null when the chunk payload is not valid zlib", async () => {
    const storage: ChunkBackend = {
      fetchChunk: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)),
    };

    expect(await getPointElevation(41.95, -73.89, storage)).toBeNull();
  });
});

describe("getPointElevation — AWS terrarium fallback", () => {
  const BLACKLISTED = { lat: 36.5, lon: -116.5 }; // N36W116 (Death Valley)
  // z13 tile x=1444 y=3202, in-tile pixel (250, 197)
  const TARGET = { x: 250, y: 197 };

  it("uses AWS terrain tiles for blacklisted SRTM tiles", async () => {
    const png = terrariumPng(256, (x, y) => (x === TARGET.x && y === TARGET.y ? [129, 244, 0] : [0, 0, 0]));
    const fetchMock = vi.fn((_url: string) => Promise.resolve(new Response(png, { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const storage = backendFor(new Map());
    const result = await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, storage);

    // 129 * 256 + 244 + 0 / 256 - 32768 = 500
    expect(result).toEqual({ elevation: 500, surfaceType: "land", source: "aws", tile: "AWS-z13-1444-3202" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/1444/3202.png",
    );
    expect(storage.fetchChunk).not.toHaveBeenCalled();
  });

  it("returns null when the AWS tile request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 404 }))));

    expect(await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()))).toBeNull();
  });

  it("returns null when the target pixel is terrarium nodata (0,0,0)", async () => {
    const png = terrariumPng(256, () => [0, 0, 0]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(png, { status: 200 }))));

    expect(await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()))).toBeNull();
  });

  it("decodes a PNG whose scanlines use the Sub filter", async () => {
    // Rebuild the IDAT manually with filter type 1 (Sub) on the target row.
    const size = 256;
    const target = { x: TARGET.x, y: TARGET.y };
    const scanlines = new Uint8Array(size * (1 + size * 3));
    for (let y = 0; y < size; y++) {
      const rowStart = y * (1 + size * 3);
      const isTargetRow = y === target.y;
      scanlines[rowStart] = isTargetRow ? 1 : 0;
      if (isTargetRow) {
        // Sub delta of 129 on the red channel at x=0 propagates to every column
        scanlines[rowStart + 1] = 129;
      }
    }
    const idat = zlibSync(scanlines);
    const bytes = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...pngChunk("IHDR", [...be32(size), ...be32(size), 8, 2, 0, 0, 0]),
      ...pngChunk("IDAT", [...idat]),
      ...pngChunk("IEND", []),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(new Uint8Array(bytes).buffer, { status: 200 }))),
    );

    const result = await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()));

    // Sub filter accumulates left to right: r=129, g=0, b=0 at the target column
    // 129 * 256 + 0 + 0 / 256 - 32768 = 256
    expect(result?.source).toBe("aws");
    expect(result?.elevation).toBe(256);
  });

  it("returns null when the PNG has no IDAT chunk", async () => {
    const bytes = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...pngChunk("IHDR", [...be32(256), ...be32(256), 8, 2, 0, 0, 0]),
      ...pngChunk("IEND", []),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(new Uint8Array(bytes).buffer, { status: 200 }))),
    );

    expect(await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()))).toBeNull();
  });

  it("returns null when the response body is not a PNG", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(new Uint8Array(64).buffer, { status: 200 }))),
    );

    expect(await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()))).toBeNull();
  });

  it("decodes a PNG whose scanlines use the Up filter", async () => {
    // Row 196 is Sub-filtered so the Up decode of row 197 must add a
    // reconstructed (non-zero) previous row, not just the stored deltas.
    const filters: number[] = [];
    filters[196] = 1; // Sub
    filters[197] = 2; // Up
    const png = buildTerrariumPNG({
      width: 256,
      height: 256,
      colorType: 2,
      filters,
      pixel: (x, y) => (y >= 196 && x === TARGET.x ? (y === 196 ? [1, 1, 0] : [129, 244, 0]) : [0, 0, 0]),
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(png, { status: 200 }))));

    const result = await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()));

    // 129 * 256 + 244 - 32768 = 500; skipping the prevRow add would yield 243
    expect(result?.elevation).toBe(500);
    expect(result?.source).toBe("aws");
  });

  it("decodes a PNG whose scanlines use the Paeth filter", async () => {
    // The pixel above the target is non-zero, so the predictor must select the
    // Up neighbour (b) for the decode to round-trip.
    const filters: number[] = [];
    filters[197] = 4; // Paeth
    const png = buildTerrariumPNG({
      width: 256,
      height: 256,
      colorType: 2,
      filters,
      pixel: (x, y) => (y === 196 && x === TARGET.x ? [50, 50, 50] : y === 197 && x === TARGET.x ? [129, 244, 0] : [0, 0, 0]),
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(png, { status: 200 }))));

    const result = await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()));

    expect(result?.elevation).toBe(500);
  });

  it("passes scanlines with an unrecognised filter type through unchanged", async () => {
    // The fixture stores unknown filter types raw; the decoder's default case
    // must treat the stored bytes as final pixel values.
    const filters: number[] = [];
    filters[197] = 7;
    const png = buildTerrariumPNG({
      width: 256,
      height: 256,
      colorType: 2,
      filters,
      pixel: (x, y) => (y === 197 && x === TARGET.x ? [129, 244, 0] : [0, 0, 0]),
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(png, { status: 200 }))));

    const result = await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()));

    expect(result?.elevation).toBe(500);
  });

  it("falls back to fflate's zlib inflate when DecompressionStream is unavailable", async () => {
    // Regression: the fallback imported inflateSync (raw DEFLATE), which throws
    // "unexpected EOF" on the zlib-wrapped IDAT stream and returned null for
    // every tile on runtimes without DecompressionStream.
    vi.stubGlobal("DecompressionStream", undefined);
    const png = terrariumPng(256, (x, y) => (x === TARGET.x && y === TARGET.y ? [129, 244, 0] : [0, 0, 0]));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(png, { status: 200 }))));

    const result = await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()));

    expect(result?.elevation).toBe(500);
    expect(result?.source).toBe("aws");
  });

  it("returns null when reading the response body throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.reject(new Error("stream aborted")) } as unknown as Response)),
    );

    expect(await getPointElevation(BLACKLISTED.lat, BLACKLISTED.lon, backendFor(new Map()))).toBeNull();
  });
});
