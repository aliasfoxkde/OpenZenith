import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MERCATOR_LAT, crs84MatrixSize, crs84TileBounds, getTileDataCRS84 } from "../tile-crs84";
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

/** A 404 from the AWS Terrain source, as a missing tile answers. */
function notFoundResponse(): Response {
  return new Response("not found", { status: 404 });
}

/**
 * Terrarium PNG carrying only `rows` of the usual 256 — the shape the sampler
 * sees when an upstream payload is truncated, where reading past it would be
 * an out-of-bounds access.
 */
function shortElevationPng(elevation: number, rows: number): Response {
  const r = Math.floor((elevation + 32768) / 256);
  const g = elevation + 32768 - r * 256;
  return awsResponse(
    buildTerrariumPNG({
      width: TILE_SIZE,
      height: rows,
      colorType: 2,
      pixel: () => [r, g, 0],
    }),
  );
}

/** The 3857 zoom level the assembler samples a z4 CRS84 tile at. */
const ZA = 4 + 1;
/** Bounds of the z4 CRS84 tile the partial-coverage tests use. */
const TILE_BOUNDS = crs84TileBounds(4, 0, 4);

/** Fractional Web Mercator y of a latitude, the assembler's own transform. */
function mercatorY(lat: number): number {
  const latRad = (lat * Math.PI) / 180;
  return (2 ** ZA * (1 - Math.asinh(Math.tan(latRad)) / Math.PI)) / 2;
}

/**
 * Rows of TILE_BOUNDS whose pixel centres land inside Web Mercator source row
 * `sourceRow` — the tiles that row of pixels is sampled from.
 */
function rowsSamplingMercatorRow(sourceRow: number): number[] {
  return rowsSamplingWithinMercatorRow(sourceRow, TILE_SIZE);
}

/**
 * Rows of TILE_BOUNDS whose pixel centres land within the first `storedRows`
 * pixel rows of Web Mercator source row `sourceRow`, i.e. the cells a source
 * tile truncated to `storedRows` rows can still serve.
 */
function rowsSamplingWithinMercatorRow(sourceRow: number, storedRows: number): number[] {
  const latStep = (TILE_BOUNDS.north - TILE_BOUNDS.south) / TILE_SIZE;
  const rows: number[] = [];
  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = TILE_BOUNDS.north - (py + 0.5) * latStep;
    const ty = mercatorY(lat);
    if (Math.floor(ty) !== sourceRow) continue;
    if (Math.floor((ty - sourceRow) * TILE_SIZE) < storedRows) rows.push(py);
  }
  return rows;
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

  it("bounds a z11 tile inside the N36W116 SRTM cell exactly", () => {
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
    expect(fetchMock.mock.calls.map((c) => c[0] as string).sort()).toEqual([
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
    const result = await getTileDataCRS84(10, 371, 304, storage);

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

  it("leaves the rows of a missing 3857 tile nodata while its sibling still renders", async () => {
    // za = 5 cover for the z4 tile is rows 11 and 12; only row 11 answers, so
    // every pixel whose source row is 12 has no tile to sample from.
    stubFetch((url) => (url.endsWith("/12.png") ? notFoundResponse() : constantElevationPng(100)));
    const storage = failingStorage("AWS is the primary source here");

    const result = await getTileDataCRS84(4, 0, 4, storage);

    const values = Array.from(result.data);
    const servedRows = rowsSamplingMercatorRow(11);
    const missingRows = rowsSamplingMercatorRow(12);
    expect(servedRows.length).toBeGreaterThan(0);
    expect(missingRows.length).toBeGreaterThan(0);
    for (const py of servedRows) {
      for (let px = 0; px < TILE_SIZE; px++) expect(values[py * TILE_SIZE + px]).toBe(EL100);
    }
    for (const py of missingRows) {
      for (let px = 0; px < TILE_SIZE; px++) expect(values[py * TILE_SIZE + px]).toBe(NODATA);
    }
  });

  it("keeps a degraded short 3857 tile from being sampled past its buffer", async () => {
    // Both source tiles report only 8 of their 256 rows: the sampler must skip
    // the pixel centres that index past the truncated payload instead of
    // reading out of bounds, leaving those cells nodata.
    stubFetch((url) => (url.includes("/terrarium/5/0/1") ? shortElevationPng(100, 8) : null));
    const storage = failingStorage("AWS is the primary source here");

    const result = await getTileDataCRS84(4, 0, 4, storage);

    const values = Array.from(result.data);
    let servedRows = 0;
    let nodataRows = 0;
    for (let py = 0; py < TILE_SIZE; py++) {
      const rowValues = values.slice(py * TILE_SIZE, py * TILE_SIZE + TILE_SIZE);
      if (rowValues.every((v) => v === EL100)) servedRows++;
      else if (rowValues.every((v) => v === NODATA)) nodataRows++;
      else throw new Error(`row ${py} is a mix of served and nodata cells`);
    }
    // Exactly the pixel rows whose source row is one of the 8 stored ones.
    const expected = new Set<number>();
    for (const sourceRow of [11, 12]) {
      for (const py of rowsSamplingWithinMercatorRow(sourceRow, 8)) expected.add(py);
    }
    expect(servedRows).toBe(expected.size);
    expect(servedRows).toBeGreaterThan(0);
    expect(servedRows + nodataRows).toBe(TILE_SIZE);
  });
});

describe("getTileDataCRS84 — HuggingFace chunk path (z > 10)", () => {
  /**
   * z11 CRS84 tile whose bounds sit fully inside the N36W115 SRTM cell
   * (lat 36..37, lon -115..-114).
   */
  const INSIDE = { z: 11, col: 740, row: 608 };
  /** Sibling tile straddling the -115 meridian into blacklisted N36W116. */
  const BLACKLIST = { z: 11, col: 739, row: 608 };

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
      expect(url).toContain("/terrarium/12/74");
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

    const names = (storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
    expect(names).toContain("N36W115.tif");
    expect(names.some((n: string) => n.includes("N36W116"))).toBe(false);
    // The blacklist triggered the AWS attempt even though chunks produced data
    const abortSignal = expect.any(AbortSignal) as AbortSignal;
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/elevation-tiles-prod/terrarium/12/"), {
      signal: abortSignal,
    });
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
