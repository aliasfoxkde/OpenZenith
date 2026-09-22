import { describe, it, expect, vi, beforeEach } from "vitest";
import { zlibSync } from "fflate";
import type { ChunkBackend } from "../storage/backend";

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
 * Predictor-encode and zlib-compress a chunk exactly the way the SRTM
 * TIFF store does, so that decoding undoes horizontal differencing.
 */
function encodeChunk(elevationAt: (row: number, col: number) => number, width: number, height: number): Uint8Array {
  const raw = new Int16Array(width * height);
  for (let r = 0; r < height; r++) {
    let prev = 0;
    for (let c = 0; c < width; c++) {
      const decoded = elevationAt(r, c) | 0;
      raw[r * width + c] = (decoded - prev) | 0;
      prev = decoded;
    }
  }
  // SRTM chunk payloads are zlib-wrapped deflate, which is what unzlibSync expects
  return zlibSync(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
}

function chunkOf(elevationAt: (row: number, col: number) => number, width: number, height: number): ArrayBuffer {
  const deflated = encodeChunk(elevationAt, width, height);
  return deflated.buffer.slice(deflated.byteOffset, deflated.byteOffset + deflated.byteLength) as ArrayBuffer;
}

type ChunkTable = Map<string, ArrayBuffer>;

/** 256x256 chunks keyed by "row:col"; chunk 14 is the 17px remainder row/col. */
function chunkSize(row: number, col: number): { width: number; height: number } {
  return { width: col < 14 ? 256 : 17, height: row < 14 ? 256 : 17 };
}

function buildChunks(build: (row: number, col: number) => ((r: number, c: number) => number) | null): ChunkTable {
  const table: ChunkTable = new Map();
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const elevationAt = build(row, col);
      if (!elevationAt) continue;
      const { width, height } = chunkSize(row, col);
      table.set(`${row}:${col}`, chunkOf(elevationAt, width, height));
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
    const storage = backendFor(buildChunks(() => () => 100));

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
    const storage = backendFor(buildChunks(() => () => 500));

    const result = await getPointElevation(41.95, -73.95, storage);
    expect(result?.elevation).toBe(500);
    expect(result?.source).toBe("srtm");
  });

  it("caches fetched chunks under the oz:chunk key", async () => {
    const storage = backendFor(buildChunks(() => () => 500));

    await getPointElevation(41.95, -73.95, storage);

    expect(cachePutMock).toHaveBeenCalledTimes(1);
    expect(cachePutMock.mock.calls[0][0]).toBe("oz:chunk:N41W073.tif:0:0");
    expect(cachePutMock.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
  });

  it("serves a cached chunk without hitting the backend", async () => {
    const storage = backendFor(buildChunks(() => () => 500));
    const cached = chunkOf(() => 777, 256, 256);
    cacheGetMock.mockResolvedValue(cached);

    const result = await getPointElevation(41.95, -73.95, storage);

    expect(result?.elevation).toBe(777);
    expect(storage.fetchChunk).not.toHaveBeenCalled();
    expect(cachePutMock).not.toHaveBeenCalled();
  });

  it("reads the 17px remainder chunk at the south-east corner of a tile", async () => {
    // lat 41 / lon -73 is the last pixel of N41W073 -> chunk (14,14) is 17x17
    const storage = backendFor(buildChunks((row, col) => (r, c) => 100 + row * 17 + r + (col * 17 + c)));

    const result = await getPointElevation(41.0, -73.0, storage);

    // local pixel (16,16) -> 100 + 14*17 + 16 + 14*17 + 16 = 608
    expect(result).toEqual({ elevation: 608, surfaceType: "land", source: "srtm", tile: "N41W073" });
    expect(storage.fetchChunk).toHaveBeenCalledWith("N41W073.tif", 14, 14);
  });

  it("returns null when the target pixel is SRTM nodata", async () => {
    const storage = backendFor(buildChunks(() => () => -32768));

    expect(await getPointElevation(41.95, -73.95, storage)).toBeNull();
  });

  it("returns null when the backend cannot fetch the chunk", async () => {
    const storage: ChunkBackend = {
      fetchChunk: vi.fn(() => Promise.reject(new Error("chunk not found"))),
    };

    expect(await getPointElevation(41.95, -73.95, storage)).toBeNull();
  });

  it("returns null when the chunk payload is not valid zlib", async () => {
    const storage: ChunkBackend = {
      fetchChunk: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)),
    };

    expect(await getPointElevation(41.95, -73.95, storage)).toBeNull();
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
});
