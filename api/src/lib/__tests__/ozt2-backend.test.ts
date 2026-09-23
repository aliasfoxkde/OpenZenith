/**
 * Tests for src/lib/storage/ozt2-backend.ts.
 *
 * Real OZT2 tiles (zlib compressed, 16 bit lossless) are synthesised in-memory
 * and served through a stubbed fetch, so decoding, caching and the merged-chunk
 * fallback all run against genuine bytes.
 *
 * Every test uses a geographically distinct point: decoded tiles live in a
 * module-level cache keyed by tile coordinate, so a repeated tile would skip
 * the fetch under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deflateSync } from "node:zlib";

const { cacheGetMock, cachePutMock, fetchChunkMock } = vi.hoisted(() => ({
  cacheGetMock: vi.fn<(key: string) => Promise<ArrayBuffer | null>>(),
  cachePutMock: vi.fn<(key: string, data: ArrayBuffer) => Promise<void>>(),
  fetchChunkMock: vi.fn<(srtmName: string, row: number, col: number) => Promise<ArrayBuffer>>(),
}));

vi.mock("@/lib/storage/cache", () => ({
  cacheGet: (key: string) => cacheGetMock(key),
  cachePut: (key: string, data: ArrayBuffer) => cachePutMock(key, data),
}));

vi.mock("@/lib/storage/huggingface-backend", () => {
  class StubChunkBackend {
    fetchChunk = (srtmName: string, row: number, col: number) => fetchChunkMock(srtmName, row, col);
    constructor(
      public repo: string,
      public tryMerged: boolean,
    ) {}
  }

  return {
    HuggingFaceChunkBackend:
      StubChunkBackend as unknown as typeof import("@/lib/storage/huggingface-backend").HuggingFaceChunkBackend,
  };
});

import { OZT2HuggingFaceBackend } from "@/lib/storage/ozt2-backend";
import { latLonToTile } from "@/lib/srtm/zoom-math";
import { chunkRealExtent } from "@/lib/srtm/merged-parser";

const REPO = "aliasfox/srtm30m-ozt2-v2";
const BASE = "https://huggingface.co/datasets";
const COMPRESSOR_ZLIB = 2;
const NODATA = -32768;

function tileUrl(lat: number, lon: number, zoom: number, repo: string = REPO): string {
  const { x, y } = latLonToTile(lat, lon, zoom);
  return `${BASE}/${repo}/resolve/main/tiles/z${zoom}/${x}/${y}.ozt2`;
}

function tileKey(lat: number, lon: number, zoom: number): string {
  const { x, y } = latLonToTile(lat, lon, zoom);
  return `oz:ozt2:${zoom}:${x}:${y}`;
}

/** Encode residual elevations as a zlib-compressed, 16 bit lossless OZT2 tile. */
function buildOzt2Tile(residuals: Int16Array, vmin = 0, bits = 16, elevRange = 0): ArrayBuffer {
  const body = deflateSync(new Uint8Array(residuals.buffer, residuals.byteOffset, residuals.byteLength), {
    level: 6,
  });
  const out = new ArrayBuffer(6 + body.byteLength);
  const view = new DataView(out);
  view.setInt16(0, vmin, true);
  view.setUint16(2, elevRange, true);
  view.setUint8(4, bits);
  view.setUint8(5, (COMPRESSOR_ZLIB << 2) | 0); // zlib, no predictor
  new Uint8Array(out).set(body, 6);
  return out;
}

function flatTile(value: number): ArrayBuffer {
  return buildOzt2Tile(Int16Array.from({ length: 256 * 256 }, () => value));
}

function checkerboardTile(high: number, low: number): ArrayBuffer {
  const residuals = new Int16Array(256 * 256);
  for (let row = 0; row < 256; row++) {
    for (let col = 0; col < 256; col++) {
      residuals[row * 256 + col] = (row + col) % 2 === 0 ? high : low;
    }
  }
  return buildOzt2Tile(residuals);
}

/** Mirrors the chunk geometry the backend derives for the merged fallback. */
function chunkGeometry(lat: number, lon: number) {
  const latDeg = Math.floor(Math.abs(lat));
  const lonDeg = Math.floor(Math.abs(lon));
  const srtmName = `${lat >= 0 ? "N" : "S"}${String(latDeg).padStart(2, "0")}${lon >= 0 ? "E" : "W"}${String(lonDeg).padStart(3, "0")}.tif`;
  const latMax = lat >= 0 ? latDeg + 1 : -latDeg;
  const lonMin = lon >= 0 ? lonDeg : -(lonDeg + 1);
  const row = Math.round((latMax - lat) * 3600);
  const col = Math.round((lon - lonMin) * 3600);
  const chunkRow = Math.floor(row / 256);
  const chunkCol = Math.floor(col / 256);
  return {
    srtmName,
    chunkRow,
    chunkCol,
    localRow: row - chunkRow * 256,
    localCol: col - chunkCol * 256,
    key: `oz:chunk:${srtmName}:${chunkRow}:${chunkCol}`,
  };
}

/** Delta-encoded chunk whose every reconstructed pixel equals `value`.
 * Stored 256x256 with zero-delta padding, as real producers store edge chunks. */
function buildZlibChunk(value: number, chunkRow = 0, chunkCol = 0): ArrayBuffer {
  const stride = 256;
  const deltas = new Int16Array(stride * stride);
  const { height } = chunkRealExtent(chunkRow, chunkCol);
  for (let row = 0; row < height; row++) {
    deltas[row * stride] = value;
  }
  const compressed = deflateSync(new Uint8Array(deltas.buffer, deltas.byteOffset, deltas.byteLength), {
    level: 6,
  });
  const out = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(out).set(compressed);
  return out;
}

describe("OZT2HuggingFaceBackend", () => {
  const tiles = new Map<string, ArrayBuffer | { status: number }>();
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

  function serveTile(lat: number, lon: number, body: ArrayBuffer, zoom = 10, repo?: string): void {
    tiles.set(tileUrl(lat, lon, zoom, repo), body);
  }

  beforeEach(() => {
    tiles.clear();
    cacheGetMock.mockClear();
    cachePutMock.mockClear();
    fetchChunkMock.mockClear();
    cacheGetMock.mockResolvedValue(null);
    cachePutMock.mockResolvedValue(undefined);
    fetchChunkMock.mockResolvedValue(new ArrayBuffer(0));
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: string) => {
      const entry = tiles.get(input);
      if (!entry || "status" in entry) {
        const status = entry && "status" in entry ? entry.status : 404;
        return Promise.resolve(new Response("not found", { status }));
      }
      return Promise.resolve(new Response(entry, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fetches and decodes a tile from the default dataset at the default zoom", async () => {
    const backend = new OZT2HuggingFaceBackend();
    const lat = 40.7128;
    const lon = -74.006;
    serveTile(lat, lon, flatTile(321));

    const { x, y } = latLonToTile(lat, lon, 10);
    const tile = await backend.getTile(10, x, y);

    expect(requestedUrlOf(fetchMock)).toBe(tileUrl(lat, lon, 10));
    expect(tile).not.toBeNull();
    expect(tile?.length).toBe(256 * 256);
    expect(Array.from(tile as Int16Array).every((value) => value === 321)).toBe(true);
  });

  it("honours a custom repo id and zoom", async () => {
    const backend = new OZT2HuggingFaceBackend({ repoId: "acme/ozt2", zoom: 9 });
    const lat = 41.0;
    const lon = -73.0;
    serveTile(lat, lon, flatTile(250), 9, "acme/ozt2");

    const { x, y } = latLonToTile(lat, lon, 9);
    const tile = await backend.getTile(9, x, y);

    expect(requestedUrlOf(fetchMock)).toBe(tileUrl(lat, lon, 9, "acme/ozt2"));
    expect(Array.from(tile as Int16Array)[0]).toBe(250);
  });

  it("aborts a tile fetch once the configured timeout elapses", async () => {
    vi.useFakeTimers();
    const backend = new OZT2HuggingFaceBackend({ timeoutSecs: 2 });
    const lat = 19.4326;
    const lon = -99.1332;
    fetchMock.mockImplementation((_input: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => { reject(new Error("The operation was aborted")); });
      });
    });

    const { x, y } = latLonToTile(lat, lon, 10);
    const pending = backend.getTile(10, x, y);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await pending).toBeNull();
  });

  it("writes the raw tile into the chunk cache after a successful fetch", async () => {
    const lat = 34.0522;
    const lon = -118.2437;
    serveTile(lat, lon, flatTile(42));
    const backend = new OZT2HuggingFaceBackend();

    await backend.getElevation(lat, lon);

    expect(cachePutMock).toHaveBeenCalledTimes(1);
    const [key, data] = cachePutMock.mock.calls[0];
    expect(key).toBe(tileKey(lat, lon, 10));
    expect(data.byteLength).toBeGreaterThan(0);
  });

  it("serves a tile from the chunk cache without a network request", async () => {
    const lat = 36.1699;
    const lon = -115.1398;
    // The cache stores the raw compressed OZT2 bytes (what cachePut writes
    // after a fetch) — the read path must decode, not reinterpret.
    const compressed = flatTile(103);
    cacheGetMock.mockImplementation((key: string) =>
      Promise.resolve(key === tileKey(lat, lon, 10) ? compressed : null),
    );
    const backend = new OZT2HuggingFaceBackend();

    const tile = (await backend.getTile(10, latLonToTile(lat, lon, 10).x, latLonToTile(lat, lon, 10).y)) as Int16Array;

    expect(requestedUrlOf(fetchMock)).toBeNull();
    expect(Array.from(tile)).toEqual(Array.from({ length: 256 * 256 }, () => 103));
  });

  it("returns null when the tile is not in the dataset", async () => {
    const backend = new OZT2HuggingFaceBackend();
    tiles.set(tileUrl(51.5074, -0.1278, 10), { status: 404 });

    const { x, y } = latLonToTile(51.5074, -0.1278, 10);
    expect(await backend.getTile(10, x, y)).toBeNull();
  });

  it("returns null when the fetch fails", async () => {
    vi.useFakeTimers();
    const backend = new OZT2HuggingFaceBackend();
    tiles.set(tileUrl(48.8566, 2.3522, 10), { status: 200 });
    fetchMock.mockRejectedValueOnce(new Error("connection reset"));

    const { x, y } = latLonToTile(48.8566, 2.3522, 10);
    expect(await backend.getTile(10, x, y)).toBeNull();
  });

  it("returns null when the payload cannot be decoded", async () => {
    const backend = new OZT2HuggingFaceBackend();
    const lat = 35.6762;
    const lon = 139.6503;
    serveTile(lat, lon, new ArrayBuffer(3));

    expect(await backend.getElevation(lat, lon)).toBeNull();
  });

  it("serves repeat lookups from the in-memory tile cache", async () => {
    const lat = -33.8688;
    const lon = 151.2093;
    serveTile(lat, lon, flatTile(180));
    const backend = new OZT2HuggingFaceBackend();

    const first = await backend.getElevation(lat, lon);
    const second = await backend.getElevation(lat, lon);

    expect(first).toBe(180);
    expect(second).toBe(180);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("samples the decoded tile at the query point", async () => {
    const lat = 37.7749;
    const lon = -122.4194;
    serveTile(lat, lon, flatTile(312));
    const backend = new OZT2HuggingFaceBackend();

    expect(await backend.getElevation(lat, lon)).toBe(312);
  });

  it("renormalises the interpolation when corners are NoData", async () => {
    const lat = -1.2921;
    const lon = 36.8219;
    serveTile(lat, lon, checkerboardTile(100, NODATA));
    const backend = new OZT2HuggingFaceBackend();

    expect(await backend.getElevation(lat, lon)).toBe(100);
  });

  it("falls back to merged chunks when the OZT2 tile is missing", async () => {
    const lat = 55.7558;
    const lon = 37.6173;
    const geometry = chunkGeometry(lat, lon);
    fetchChunkMock.mockResolvedValue(buildZlibChunk(500, geometry.chunkRow, geometry.chunkCol));
    const backend = new OZT2HuggingFaceBackend();

    const elevation = await backend.getElevation(lat, lon);

    expect(elevation).toBe(500);
    expect(fetchChunkMock).toHaveBeenCalledWith(geometry.srtmName, geometry.chunkRow, geometry.chunkCol);
    expect(cachePutMock).toHaveBeenCalledWith(geometry.key, expect.any(ArrayBuffer));
  });

  it("serves the fallback chunk from the chunk cache on the next lookup", async () => {
    const lat = 52.52;
    const lon = 13.405;
    const geometry = chunkGeometry(lat, lon);
    const chunk = buildZlibChunk(320, geometry.chunkRow, geometry.chunkCol);
    fetchChunkMock.mockResolvedValue(chunk);
    const backend = new OZT2HuggingFaceBackend();

    const first = await backend.getElevation(lat, lon);
    expect(first).toBe(320);
    // The first lookup consults the tile cache, then the chunk cache.
    const keys = cacheGetMock.mock.calls.map((call) => call[0]);
    expect(keys).toContain(geometry.key);

    cacheGetMock.mockImplementation((key: string) => Promise.resolve(key === geometry.key ? chunk : null));
    const second = await backend.getElevation(lat, lon);

    expect(second).toBe(320);
    expect(fetchChunkMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the fallback chunk only has NoData", async () => {
    const lat = 45.4642;
    const lon = 9.19;
    const geometry = chunkGeometry(lat, lon);
    serveTile(lat, lon, flatTile(NODATA));
    fetchChunkMock.mockResolvedValue(buildZlibChunk(NODATA, geometry.chunkRow, geometry.chunkCol));
    const backend = new OZT2HuggingFaceBackend();

    expect(await backend.getElevation(lat, lon)).toBeNull();
  });

  it("returns null when neither the tile nor the fallback chunk can be decoded", async () => {
    const lat = 59.3293;
    const lon = 18.0686;
    fetchChunkMock.mockResolvedValue(new ArrayBuffer(0));
    const backend = new OZT2HuggingFaceBackend();

    expect(await backend.getElevation(lat, lon)).toBeNull();
  });

  it("propagates fallback failures as null", async () => {
    const lat = 48.2082;
    const lon = 16.3738;
    fetchChunkMock.mockRejectedValue(new Error("chunk missing"));
    const backend = new OZT2HuggingFaceBackend();

    expect(await backend.getElevation(lat, lon)).toBeNull();
  });
});

function requestedUrlOf(fetchMock: { mock: { calls: Array<[string, RequestInit?]> } }): string | null {
  const first = fetchMock.mock.calls.at(0);
  return first ? first[0] : null;
}
