import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTileData } from "../tile";
import { tileToLatLon } from "../srtm/zoom-math";
import { latLonToPixel } from "../srtm/tile-math";
import type { ChunkBackend } from "../storage/backend";
import {
  PNG_SIGNATURE,
  buildChunk,
  buildTerrariumPNG,
  ihdrFor,
  pngChunk,
  awsResponse,
  constantStorage,
  failingStorage,
  stubFetch,
  terrariumElevation,
  type PngOptions,
} from "./tile-fixtures";

/**
 * Tests for the tile assembler in src/lib/tile.ts.
 *
 * The module under test is imported for real (other suites mock it). Its two
 * I/O boundaries are replaced by the shared fixtures in ./tile-fixtures:
 * global fetch serves hand-built Terrarium PNGs, and the chunk cache/storage
 * pair serves hand-built deflate chunks with the TIFF horizontal predictor
 * already applied.
 */

const NODATA = -32768;
const TILE_SIZE = 256;
const BLACK_PIXEL: [number, number, number] = [0, 0, 0];

const { chunkStore } = vi.hoisted(() => ({ chunkStore: new Map<string, ArrayBuffer>() }));

vi.mock("@/lib/storage/cache", () => ({
  cacheGet: (key: string): Promise<ArrayBuffer | null> => Promise.resolve(chunkStore.get(key) ?? null),
  cachePut: (key: string, data: ArrayBuffer): Promise<void> => {
    chunkStore.set(key, data);
    return Promise.resolve();
  },
}));

// ─── Shared tile coordinates ──────────────────────────────────────────────────

/** z11 tile fully inside the N36W115 SRTM cell. */
const INSIDE_TILE = { z: 11, x: 365, y: 802 };
/** z11 tile straddling the -116 meridian (N36W116 is on the corrupted list). */
const BLACKLIST_TILE = { z: 11, x: 364, y: 802 };
/** z11 tile straddling -116 at ~40N, away from the blacklist. */
const STRADDLE_TILE = { z: 11, x: 364, y: 771 };
/** z10 tile straddling -116 at ~36N: exercises multi-cell assembly below the AWS cutoff. */
const OVERVIEW_HF_TILE = { z: 10, x: 182, y: 401 };

beforeEach(() => {
  chunkStore.clear();
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getTileData — AWS terrain source", () => {
  it("serves overview zoom levels straight from AWS", async () => {
    const fetchMock = stubFetch((url) => {
      expect(url).toBe("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/12/14.png");
      return awsResponse(
        buildTerrariumPNG({
          width: 2,
          height: 2,
          colorType: 2,
          pixel: (x, y) => [x === 0 ? 0 : 1, 2 + y, 3],
        }),
      );
    });
    const storage = constantStorage(() => 999);

    const result = await getTileData(5, 12, 14, storage);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(result.zoom).toBe(5);
    expect(result.width).toBe(TILE_SIZE);
    expect(result.height).toBe(TILE_SIZE);
    expect(result.data[0]).toBe(terrariumElevation(0, 2, 3));
    expect(result.data[1]).toBe(terrariumElevation(1, 2, 3));
    expect(result.data[2]).toBe(terrariumElevation(0, 3, 3));
  });

  it("assembles from HuggingFace chunks when AWS fails below the cutoff", async () => {
    stubFetch(() => null);
    const storage = constantStorage(() => 800);

    const result = await getTileData(OVERVIEW_HF_TILE.z, OVERVIEW_HF_TILE.x, OVERVIEW_HF_TILE.y, storage);

    expect(result.zoom).toBe(10);
    // The tile straddles blacklisted N36W116 (Death Valley) — those cells stay
    // NODATA while the valid neighbors assemble from HuggingFace chunks.
    const values = Array.from(result.data);
    expect(values).toContain(800);
    expect(values).toContain(NODATA);
  });

  it("returns nodata outside SRTM coverage when AWS fails", async () => {
    const fetchMock = stubFetch(() => null);
    const storage = failingStorage("no chunks in the Arctic");

    // z11 y0 sits at ~85N, far above the SRTM latitude limit.
    const result = await getTileData(11, 0, 0, storage);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(Array.from(result.data).every((v) => v === NODATA)).toBe(true);
  });

  it("uses AWS for tiles outside SRTM coverage", async () => {
    stubFetch(() =>
      awsResponse(
        buildTerrariumPNG({
          width: 1,
          height: 1,
          colorType: 2,
          pixel: () => [128, 0, 0],
        }),
      ),
    );

    const result = await getTileData(11, 0, 0, failingStorage("unused"));

    expect(result.data[0]).toBe(terrariumElevation(128, 0, 0));
    expect(Array.from(result.data).every((v) => v === terrariumElevation(128, 0, 0))).toBe(true);
  });

  it("returns nodata for ocean tiles that neither source can fill", async () => {
    stubFetch(() => null);
    const storage = failingStorage("unused");

    // z11 y2047 is ~85S, below the SRTM latitude floor.
    const result = await getTileData(11, 1000, 2047, storage);

    expect(Array.from(result.data).every((v) => v === NODATA)).toBe(true);
  });
});

describe("getTileData — HuggingFace chunk assembly", () => {
  it("builds a full tile from overlapping chunks at high zoom", async () => {
    const fetchMock = stubFetch(() => null);
    const storage = constantStorage(() => 1234);

    const result = await getTileData(INSIDE_TILE.z, INSIDE_TILE.x, INSIDE_TILE.y, storage);

    expect(result.zoom).toBe(11);
    expect(Array.from(result.data).every((v) => v === 1234)).toBe(true);
    // Chunks are cached between requests.
    expect(chunkStore.size).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads cached chunks instead of refetching them", async () => {
    const storage = constantStorage(() => 55);
    await getTileData(INSIDE_TILE.z, INSIDE_TILE.x, INSIDE_TILE.y, storage);
    const firstCalls = (storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls.length;

    await getTileData(INSIDE_TILE.z, INSIDE_TILE.x, INSIDE_TILE.y, storage);

    expect((storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls.length).toBe(firstCalls);
  });

  it("keeps nodata where the source chunk has no data", async () => {
    // Source row 2467 is the row the first output row samples: blank it out.
    const blankedRow = 2467;
    const blankedChunkRow = Math.floor(blankedRow / 256);
    const blankedLocalRow = blankedRow - blankedChunkRow * 256;
    const storage: ChunkBackend = {
      fetchChunk: vi.fn(
        (_name: string, row: number, col: number): Promise<ArrayBuffer> =>
          Promise.resolve(buildChunk((r) => (row === blankedChunkRow && r === blankedLocalRow ? NODATA : 4321), row, col)),
      ),
    };

    const result = await getTileData(INSIDE_TILE.z, INSIDE_TILE.x, INSIDE_TILE.y, storage);

    // Work out which output rows read the blanked source row.
    const bounds = tileToLatLon(INSIDE_TILE.z, INSIDE_TILE.x, INSIDE_TILE.y);
    const srtmBounds = { latMin: 36, latMax: 37, lonMin: -116, lonMax: -115 };
    const latStep = (bounds.north - bounds.south) / TILE_SIZE;
    const affectedRows = new Set<number>();
    for (let py = 0; py < TILE_SIZE; py++) {
      const lat = bounds.north - (py + 0.5) * latStep;
      if (latLonToPixel(lat, -115.75, srtmBounds).row === blankedRow) affectedRows.add(py);
    }
    expect(affectedRows.size).toBeGreaterThan(0);

    const values = Array.from(result.data);
    const nodata = values.filter((v) => v === NODATA);
    expect(nodata).toHaveLength(affectedRows.size * TILE_SIZE);
    expect(values.filter((v) => v === 4321)).toHaveLength(TILE_SIZE * TILE_SIZE - nodata.length);
  });

  it("assembles neighbouring SRTM cells and skips the missing one", async () => {
    stubFetch(() => null);
    const calls: string[] = [];
    const storage: ChunkBackend = {
      fetchChunk: vi.fn((srtmName: string, row: number, col: number): Promise<ArrayBuffer> => {
        calls.push(srtmName);
        // The sliver west of -116 belongs to N40W116, which has no chunks here.
        if (srtmName === "N40W116.tif") throw new Error("chunk not found");
        return Promise.resolve(buildChunk(() => 4321, row, col));
      }),
    };

    const result = await getTileData(STRADDLE_TILE.z, STRADDLE_TILE.x, STRADDLE_TILE.y, storage);

    expect(calls).toContain("N40W115.tif");
    expect(calls).toContain("N40W116.tif");

    const bounds = tileToLatLon(STRADDLE_TILE.z, STRADDLE_TILE.x, STRADDLE_TILE.y);
    const lonStep = (bounds.east - bounds.west) / TILE_SIZE;
    let nodataColumns = 0;
    for (let px = 0; px < TILE_SIZE; px++) {
      if (bounds.west + (px + 0.5) * lonStep < -116) nodataColumns++;
    }
    expect(nodataColumns).toBeGreaterThan(0);
    // Columns west of -116 come from the failed cell and stay nodata.
    expect(Array.from(result.data).filter((v) => v === NODATA)).toHaveLength(nodataColumns * TILE_SIZE);
    expect(result.data[nodataColumns]).toBe(4321); // first column served by N40W115
  });

  it("requests the straddling cells concurrently during assembly", async () => {
    // Cold multi-cell tiles must not serialise their per-cell downloads: the
    // first cell's first chunk only resolves once the second cell's first
    // chunk is ALSO requested (with a watchdog so a sequential assembler
    // fails the value assertions instead of hanging the test).
    stubFetch(() => null);
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const secondCellArrived = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const storage: ChunkBackend = {
      fetchChunk: (srtmName: string, row: number, col: number): Promise<ArrayBuffer> => {
        calls.push(srtmName);
        if (calls.length === 1) {
          return Promise.race([
            secondCellArrived.then(() => buildChunk(() => 4321, row, col)),
            new Promise<ArrayBuffer>((_, reject) =>
              setTimeout(() => { reject(new Error("second cell never requested — assembly is sequential")); }, 200),
            ),
          ]);
        }
        releaseFirst();
        return Promise.resolve(buildChunk(() => 4321, row, col));
      },
    };

    const result = await getTileData(STRADDLE_TILE.z, STRADDLE_TILE.x, STRADDLE_TILE.y, storage);

    expect(calls.some((name) => name === "N40W115.tif")).toBe(true);
    expect(calls.some((name) => name === "N40W116.tif")).toBe(true);
    // Both cells contributed: a sequential assembler loses the gated cell to
    // the watchdog and leaves its ~2/3 of the tile as NODATA.
    const nodata = Array.from(result.data).filter((v) => v === NODATA).length;
    expect(nodata).toBeLessThan(TILE_SIZE * TILE_SIZE * 0.4);
  });

  it("falls back to AWS when HuggingFace produces no valid pixels", async () => {
    stubFetch(() =>
      awsResponse(
        buildTerrariumPNG({
          width: 1,
          height: 1,
          colorType: 2,
          pixel: () => [192, 0, 0],
        }),
      ),
    );
    const storage = constantStorage(() => NODATA);

    const result = await getTileData(INSIDE_TILE.z, INSIDE_TILE.x, INSIDE_TILE.y, storage);

    expect(result.data[0]).toBe(terrariumElevation(192, 0, 0));
    expect(Array.from(result.data).every((v) => v === terrariumElevation(192, 0, 0))).toBe(true);
  });

  it("keeps HuggingFace data when AWS is no better", async () => {
    stubFetch(() =>
      awsResponse(
        buildTerrariumPNG({
          width: 1,
          height: 1,
          colorType: 2,
          pixel: () => [0, 0, 0], // decodes to nodata everywhere
        }),
      ),
    );
    const storage = constantStorage(() => NODATA);

    const result = await getTileData(INSIDE_TILE.z, INSIDE_TILE.x, INSIDE_TILE.y, storage);

    expect(Array.from(result.data).every((v) => v === NODATA)).toBe(true);
  });

  it("samples padded edge chunks at the south of a SRTM cell", async () => {
    stubFetch(() => null);
    const storage = constantStorage(() => 777);

    // z13 tile at ~36.02N: its northern rows fall in the 15th chunk row,
    // which stores 256 rows with zero-delta padding beyond the 17 real rows.
    const result = await getTileData(13, 1458, 3216, storage);

    const chunkRows = new Set((storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1]));
    expect(chunkRows).toContain(14);
    expect(Array.from(result.data).every((v) => v === 777)).toBe(true);
  });

  it("decodes padded edge-column chunks without row misalignment", async () => {
    stubFetch(() => null);
    // Per-local-pixel ramp: any predictor pass at the wrong width scrambles
    // it into padding zeros / cumulative sums far outside [400, 1420].
    const storage = constantStorage((name, r, c) => 400 + r + c * 3);

    // z13 tile (~36.0-36.08N, lon -114.041..-113.997): columns west of -114.0
    // land in the last 17 pixel columns of N36W114 (chunk col 14, stored 256
    // wide with zero-delta padding beyond the 17 real columns).
    const result = await getTileData(13, 1501, 3215, storage);

    const calls = (storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((call) => call[0] === "N36W114.tif" && call[2] === 14)).toBe(true);
    // Every sampled pixel decodes inside the ramp's range — under the broken
    // 17-wide decode, padded regions decoded as 0 / NaN here.
    const values = Array.from(result.data).filter((v) => v !== NODATA);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v >= 400 && v <= 1420)).toBe(true);
  });

  it("assembles across a SRTM latitude boundary", async () => {
    stubFetch(() => null);
    const storage = constantStorage(() => 610);

    // z11 tile spanning lat 36.03 down to 35.89: it crosses into the N35 cell,
    // and its western edge overlaps blacklisted N36W116 (Death Valley).
    const result = await getTileData(11, 364, 804, storage);

    const names = (storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(names).toContain("N36W115.tif");
    expect(names).toContain("N35W115.tif");
    expect(names.some((n: string) => n.includes("N36W116"))).toBe(false);
    // Blacklisted-source cells are NODATA; the rest assembles to 610.
    const values = Array.from(result.data);
    expect(values).toContain(610);
    expect(values).toContain(NODATA);
  });

  it("skips blacklisted SRTM tiles despite the .tif suffix and falls back to AWS", async () => {
    // see BLACKLISTED_SRTM_TILES in src/lib/tile.ts. findOverlappingSrtmTiles()
    // yields "N36W116.tif" while the blacklist stores bare "N36W116", so the
    // lookup strips the suffix before comparing. Death Valley (N36W116) is a
    // known-corrupt chunk: its cells must stay NODATA and the AWS fallback
    // must be attempted instead of assembling from the bad source.
    const fetchMock = stubFetch(() => null); // AWS unavailable → HF result wins
    const storage = constantStorage(() => 1234);

    const result = await getTileData(BLACKLIST_TILE.z, BLACKLIST_TILE.x, BLACKLIST_TILE.y, storage);

    const names = (storage.fetchChunk as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(names.some((n: string) => n.includes("N36W116"))).toBe(false);
    // AWS fallback was attempted because a blacklisted tile overlaps
    const abortSignal = expect.any(AbortSignal) as AbortSignal;
    expect(fetchMock).toHaveBeenCalledWith(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${BLACKLIST_TILE.z}/${BLACKLIST_TILE.x}/${BLACKLIST_TILE.y}.png`,
      { signal: abortSignal },
    );
    // Corrupt-source cells stay NODATA; valid neighbors still assemble
    const values = Array.from(result.data);
    expect(values).toContain(NODATA);
    expect(values).toContain(1234);
  });
});

describe("getTileData — Terrarium PNG decoding", () => {
  const pngFor = (overrides: Partial<PngOptions> = {}): Response => {
    const opts: PngOptions = {
      width: 4,
      height: 5,
      colorType: 2,
      pixel: (x, y) => [10 + x * 3, 20 + y * 2, 1],
      ...overrides,
    };
    return awsResponse(buildTerrariumPNG(opts));
  };

  it("reconstructs every PNG row filter", async () => {
    stubFetch(() => pngFor({ filters: [0, 1, 2, 3, 4] }));

    const result = await getTileData(5, 12, 14, failingStorage("unused"));

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 4; x++) {
        expect(result.data[y * 4 + x]).toBe(terrariumElevation(10 + x * 3, 20 + y * 2, 1));
      }
    }
  });

  it("treats unrecognised filter bytes as unfiltered rows", async () => {
    stubFetch(() => pngFor({ filters: [9, 9, 9, 9, 9] }));

    const result = await getTileData(5, 12, 14, failingStorage("unused"));

    expect(result.data[0]).toBe(terrariumElevation(10, 20, 1));
    expect(result.data[19]).toBe(terrariumElevation(19, 28, 1));
  });

  it("joins a PNG whose IDAT stream is split across chunks", async () => {
    stubFetch(() => pngFor({ idatChunks: 4 }));

    const result = await getTileData(5, 12, 14, failingStorage("unused"));

    expect(result.data[5]).toBe(terrariumElevation(13, 22, 1));
  });

  it("decodes RGBA pixels", async () => {
    stubFetch(() =>
      awsResponse(
        buildTerrariumPNG({
          width: 2,
          height: 2,
          colorType: 6,
          pixel: (x, y) => [1 + x, 2 + y, 3],
        }),
      ),
    );

    const result = await getTileData(5, 12, 14, failingStorage("unused"));

    expect(result.data[0]).toBe(terrariumElevation(1, 2, 3));
    expect(result.data[1]).toBe(terrariumElevation(2, 2, 3));
    expect(result.data[2]).toBe(terrariumElevation(1, 3, 3));
    expect(result.data[3]).toBe(terrariumElevation(2, 3, 3));
  });

  it("decodes grayscale pixels", async () => {
    stubFetch(() =>
      awsResponse(
        buildTerrariumPNG({
          width: 8,
          height: 2,
          colorType: 0,
          pixel: () => [64, 64, 64],
        }),
      ),
    );

    const result = await getTileData(5, 12, 14, failingStorage("unused"));

    // Grayscale rows only carry one sample per pixel, so the leading samples
    // still decode through the RGB terrarium formula.
    expect(result.data[0]).toBe(terrariumElevation(64, 64, 64));
  });

  it("falls back to RGB sampling for unmodelled colour types", async () => {
    stubFetch(() =>
      awsResponse(
        buildTerrariumPNG({
          width: 2,
          height: 2,
          colorType: 3, // palette: the decoder never reads the PLTE chunk
          pixel: (x, y) => [5 + x, 6, 7 + y],
        }),
      ),
    );

    const result = await getTileData(5, 12, 14, failingStorage("unused"));

    expect(result.data[0]).toBe(terrariumElevation(5, 6, 7));
    expect(result.data[3]).toBe(terrariumElevation(6, 6, 8));
  });

  it("resolves Paeth to the upper-left predictor on strong gradients", async () => {
    // Byte layout chosen so filter 4 at (x=1, y=2) resolves to predictor c.
    const table: [number, number, number][][] = [
      [
        [0, 0, 0],
        [7, 13, 1],
        [14, 26, 2],
        [21, 39, 3],
      ],
      [
        [31, 15, 11],
        [38, 18, 12],
        [45, 31, 13],
        [52, 44, 14],
      ],
      [
        [62, 10, 22],
        [90, 23, 32],
        [76, 36, 24],
        [83, 49, 25],
      ],
    ];
    stubFetch(() => pngFor({ filters: [4, 4, 4], height: 3, pixel: (x, y) => table[y]?.[x] ?? BLACK_PIXEL }));

    const result = await getTileData(5, 12, 14, failingStorage("unused"));

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        const [r, g, b] = table[y]?.[x] ?? [0, 0, 0];
        expect(result.data[y * 4 + x]).toBe(terrariumElevation(r, g, b));
      }
    }
  });

  it("returns nodata when the AWS payload cannot be decoded", async () => {
    // A valid-looking header with an IDAT that is not a zlib stream.
    const corrupt = new Uint8Array(
      PNG_SIGNATURE.length + pngChunk("IHDR", ihdrFor(4, 2, 2)).length + pngChunk("IDAT", new TextEncoder().encode("not-a-zlib-stream")).length,
    );
    corrupt.set(PNG_SIGNATURE, 0);
    let offset = PNG_SIGNATURE.length;
    for (const chunk of [pngChunk("IHDR", ihdrFor(4, 2, 2)), pngChunk("IDAT", new TextEncoder().encode("not-a-zlib-stream"))]) {
      corrupt.set(chunk, offset);
      offset += chunk.length;
    }
    const fetchMock = stubFetch(() => awsResponse(corrupt.buffer));

    const result = await getTileData(11, 0, 0, failingStorage("unused"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Array.from(result.data).every((v) => v === NODATA)).toBe(true);
  });

  it("maps black pixels to nodata", async () => {
    stubFetch(() =>
      awsResponse(
        buildTerrariumPNG({
          width: 2,
          height: 1,
          colorType: 2,
          pixel: (x) => (x === 0 ? [0, 0, 0] : [0, 1, 0]),
        }),
      ),
    );

    const result = await getTileData(5, 12, 14, failingStorage("unused"));

    expect(result.data[0]).toBe(NODATA);
    expect(result.data[1]).toBe(terrariumElevation(0, 1, 0));
  });

  it("returns null data paths when the payload is not a PNG", async () => {
    const fetchMock = stubFetch(() => awsResponse(new TextEncoder().encode("not a png").buffer));
    const storage = constantStorage(() => NODATA);

    // Below the AWS cutoff a broken tile falls through to HuggingFace, which is
    // also empty here, so the assembler reports all-nodata.
    const result = await getTileData(11, 0, 0, storage);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Array.from(result.data).every((v) => v === NODATA)).toBe(true);
  });

  it("treats a failed request as an empty tile source", async () => {
    const fetchMock = stubFetch(() => ({ ok: false, arrayBuffer: () => new ArrayBuffer(0) }) as unknown as Response);
    const storage = constantStorage(() => 500);

    const result = await getTileData(11, 0, 0, storage);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Array.from(result.data).every((v) => v === NODATA)).toBe(true);
  });
});
