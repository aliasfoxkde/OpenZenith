import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MERCATOR_LAT,
  crs84MatrixSize,
  crs84TileBounds,
  getTileDataCRS84,
} from "../tile-crs84";
import {
  buildChunk,
  buildTerrariumPNG,
  awsResponse,
  constantStorage,
  failingStorage,
  stubFetch,
  terrariumElevation,
} from "./tile-fixtures";
import type { ChunkBackend } from "../storage/backend";

/**
 * Tests for the WorldCRS84Quad assembler in src/lib/tile-crs84.ts.
 *
 * I/O boundaries are replaced by the shared fixtures in ./tile-fixtures: the
 * AWS 3857 source answers hand-built Terrarium PNGs, and chunk storage serves
 * hand-built deflate chunks. The suite pins the OGC 17-083r2 matrix geometry
 * and both source-priority paths (AWS resample for z<=10, HuggingFace chunk
 * assembly for z>10 with mutual fallback).
 */

const NODATA = -32768;
const TILE_SIZE = 256;

const { chunkStore } = vi.hoisted(() => ({ chunkStore: new Map<string, ArrayBuffer>() }));

vi.mock("@/lib/storage/cache", () => ({
  cacheGet: (key: string): Promise<ArrayBuffer | null> => Promise.resolve(chunkStore.get(key) ?? null),
  cachePut: (key: string, data: ArrayBuffer): Promise<void> => {
    chunkStore.set(key, data);
    return Promise.resolve();
  },
}));

beforeEach(() => {
  chunkStore.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Elevation 100 encodes as these Terrarium channels. */
const EL100 = terrariumElevation(128, 100, 0);

function constantElevationPng(elevation: number): Response {
  // r*256 + g - 32768 = elevation, with 0 <= g < 256. The sampler indexes a
  // 256x256 grid, so the fake AWS tile must be full-size.
  const r = Math.floor((elevation + 32768) / 256);
  const g = elevation + 32768 - r * 256;
  return awsResponse(
    buildTerrariumPNG({
      width: TILE_SIZE,
      height: TILE_SIZE,
      colorType: 2,
      pixel: () => [r, g, 0],
    }),
  );
}

describe("WorldCRS84Quad matrix geometry (OGC 17-083r2)", () => {
  it("uses a 2x1 root matrix that doubles in one dimension per level", () => {
    expect(crs84MatrixSize(0)).toEqual({ matrixWidth: 2, matrixHeight: 1 });
    expect(crs84MatrixSize(1)).toEqual({ matrixWidth: 4, matrixHeight: 2 });
    expect(crs84MatrixSize(10)).toEqual({ matrixWidth: 2048, matrixHeight: 1024 });
    expect(crs84MatrixSize(12)).toEqual({ matrixWidth: 8192, matrixHeight: 4096 });
  });

  it("splits the world into lat/lon rectangles with the top-left at (-180, 90)", () => {
    // Level 0 west half: -180..0, full latitude span
    expect(crs84TileBounds(0, 0, 0)).toEqual({ west: -180, east: 0, north: 90, south: -90 });
    // Level 0 east half
    expect(crs84TileBounds(0, 1, 0)).toEqual({ west: 0, east: 180, north: 90, south: -90 });
  });

  it("bounds a z11 tile inside the N36W115 SRTM cell exactly", () => {
    // All bounds are dyadic rationals, so equality is exact
    expect(crs84TileBounds(11, 728, 608)).toEqual({
      west: -116.015625,
      east: -115.927734375,
      north: 36.5625,
      south: 36.474609375,
    });
  });
});

describe("getTileDataCRS84 — AWS resample path (z <= 10)", () => {
  it("assembles a mid-latitude tile from the 3857 source one level deeper", async () => {
    // z4 tile over the eastern Pacific/South America sector; za = 5
    const fetchMock = stubFetch((url) => {
      expect(url).toMatch(/^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/5\/0\/1[12]\.png$/);
      return constantElevationPng(100);
    });
    const storage = constantStorage(() => 999);

    const result = await getTileDataCRS84(4, 0, 4, storage);

    // Both 3857 tiles spanning the tile's latitude band were fetched
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/0/11.png",
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/0/12.png",
    ]);
    // AWS is primary below z11: no chunk fetches at all
    expect((storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(result.zoom).toBe(4);
    expect(result.width).toBe(TILE_SIZE);
    expect(result.height).toBe(TILE_SIZE);
    expect(Array.from(result.data).every((v) => v === EL100)).toBe(true);
  });

  it("keeps pixels beyond the Mercator latitude limit as nodata on the z0 world tile", async () => {
    stubFetch(() => constantElevationPng(100));
    const storage = failingStorage("AWS covers everything at z0");

    const result = await getTileDataCRS84(0, 0, 0, storage);

    const latStep = 180 / TILE_SIZE;
    const nodataRows: number[] = [];
    for (let py = 0; py < TILE_SIZE; py++) {
      if (Math.abs(90 - (py + 0.5) * latStep) > MAX_MERCATOR_LAT) nodataRows.push(py);
    }
    expect(nodataRows.length).toBeGreaterThan(0);

    const values = Array.from(result.data);
    for (const py of nodataRows) {
      for (let px = 0; px < TILE_SIZE; px++) {
        expect(values[py * TILE_SIZE + px]).toBe(NODATA);
      }
    }
    // Everything between the polar caps carries the source elevation
    const validRows = TILE_SIZE - nodataRows.length;
    expect(values.filter((v) => v === EL100)).toHaveLength(validRows * TILE_SIZE);
  });

  it("falls through to chunk assembly when the 3857 source is unreachable", async () => {
    stubFetch(() => null);
    const storage = constantStorage(() => 555);

    // z10 tile sitting fully inside the N36W115 cell: the chunk assembler's
    // 3x3 probes all land in one SRTM cell, which covers every output pixel
    const result = await getTileDataCRS84(10, 365, 304, storage);

    expect((storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    expect(Array.from(result.data).every((v) => v === 555)).toBe(true);
  });

  it("serves far-southern tiles from the 3857 source without chunk fetches", async () => {
    stubFetch(() => constantElevationPng(-2500));
    const storage = failingStorage("below -56 no SRTM chunks exist");

    // z8 tile south of the SRTM latitude floor
    const result = await getTileDataCRS84(8, 28, 208, storage);

    expect((storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(Array.from(result.data).every((v) => v === -2500)).toBe(true);
  });
});

describe("getTileDataCRS84 — HuggingFace chunk path (z > 10)", () => {
  /**
   * z11 CRS84 tile whose bounds sit fully inside the N36W115 SRTM cell
   * (lat 36..37, lon -116..-115).
   */
  const INSIDE = { z: 11, col: 729, row: 608 };
  /** Sibling tile straddling the -117 meridian into blacklisted N36W116. */
  const BLACKLIST = { z: 11, col: 716, row: 608 };

  it("assembles a high-zoom tile straight from chunks without touching AWS", async () => {
    const fetchMock = stubFetch(() => null);
    const storage = constantStorage(() => 777);

    const result = await getTileDataCRS84(INSIDE.z, INSIDE.col, INSIDE.row, storage);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(Array.from(result.data).every((v) => v === 777)).toBe(true);
  });

  it("resamples from AWS when chunk assembly comes back sparse", async () => {
    // Chunks exist but hold nodata everywhere; AWS answers instead.
    stubFetch((url) => {
      expect(url).toContain("/terrarium/12/729/");
      return constantElevationPng(100);
    });
    const storage = constantStorage(() => NODATA);

    const result = await getTileDataCRS84(INSIDE.z, INSIDE.col, INSIDE.row, storage);

    expect(Array.from(result.data).every((v) => v === EL100)).toBe(true);
  });

  it("skips the blacklisted SRTM cell and attempts the AWS fallback", async () => {
    const fetchMock = stubFetch(() => null); // AWS unavailable → partial result stands
    const storage: ChunkBackend = {
      fetchChunk: vi.fn((srtmName: string, row: number, col: number): Promise<ArrayBuffer> => {
        // Most of this tile lies in N36W116 (Death Valley, corrupted source)
        if (srtmName === "N36W116.tif") return Promise.reject(new Error("chunk not found"));
        return Promise.resolve(buildChunk(() => 1234, row, col));
      }),
    };

    const result = await getTileDataCRS84(BLACKLIST.z, BLACKLIST.col, BLACKLIST.row, storage);

    const names = (storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(names).toContain("N36W117.tif");
    expect(names.some((n: string) => n.includes("N36W116"))).toBe(false);
    // The blacklist triggered the AWS attempt even though chunks produced data
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/elevation-tiles-prod/terrarium/12/"),
    );
    // Valid neighbours assemble; the corrupt-source share stays nodata
    const values = Array.from(result.data);
    expect(values).toContain(1234);
    expect(values).toContain(NODATA);
  });

  it("returns an all-nodata tile when neither source has data", async () => {
    stubFetch(() => null);
    const storage = failingStorage("no chunks here");

    const result = await getTileDataCRS84(INSIDE.z, INSIDE.col, INSIDE.row, storage);

    expect(Array.from(result.data).every((v) => v === NODATA)).toBe(true);
  });
});
