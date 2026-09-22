import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zlibSync, unzlibSync } from "fflate";
import { decodeOZT2, decodeOZT2Sync, interpolateElevation } from "../ozt2_decode";

/**
 * OZT2 fixtures are synthesised inline: header (6 bytes LE) + compressed
 * int16 residuals. The residual encoders below are the exact inverse of the
 * reconstruction passes in ozt2_decode.ts, so every decode is a round trip.
 */

const HEADER_SIZE = 6;
const PRED_NONE = 0;
const PRED_LEFT = 1;
const PRED_GRADIENT = 2;
const COMP_BROTLI = 0;
const COMP_ZSTD = 1;
const COMP_ZLIB = 2;

type Predictor = 0 | 1 | 2;

/** Quantize elevations for a given bit depth (inverse of dequantize). */
function quantize(elev: Int16Array, vmin: number, range: number, bits: number): Int16Array {
  const vmax = (1 << bits) - 1;
  const out = new Int16Array(elev.length);
  for (let i = 0; i < elev.length; i++) {
    if (bits >= 16) {
      out[i] = elev[i] - vmin;
      continue;
    }
    const q = Math.round(((elev[i] - vmin) * vmax) / range);
    out[i] = Math.max(0, Math.min(vmax, q));
  }
  return out;
}

/** Reverse the prediction passes so reconstruction reproduces `quantized`. */
function encodeResiduals(quantized: Int16Array, height: number, width: number, predictor: Predictor): Int16Array {
  if (predictor === PRED_NONE) return quantized.slice();

  const res = new Int16Array(quantized.length);
  res[0] = quantized[0];
  for (let j = 1; j < width; j++) res[j] = quantized[j] - quantized[j - 1];

  for (let i = 1; i < height; i++) {
    const row = i * width;
    const prevRow = (i - 1) * width;
    res[row] = quantized[row] - quantized[prevRow];
    for (let j = 1; j < width; j++) {
      const idx = row + j;
      if (predictor === PRED_LEFT) {
        res[idx] = quantized[idx] - quantized[idx - 1];
      } else {
        const predicted = quantized[idx - 1] + quantized[prevRow + j] - quantized[prevRow + j - 1];
        res[idx] = quantized[idx] - predicted;
      }
    }
  }
  return res;
}

/** Build the 6-byte OZT2 header. */
function buildHeader(vmin: number, range: number, bits: number, predictor: number, compressor: number): Uint8Array {
  const head = new Uint8Array(HEADER_SIZE);
  const view = new DataView(head.buffer);
  view.setInt16(0, vmin, true);
  view.setUint16(2, range, true);
  head[4] = bits;
  head[5] = ((compressor & 0x03) << 2) | (predictor & 0x03);
  return head;
}

function compressBody(residuals: Int16Array, compressor: number): Uint8Array {
  const raw = new Uint8Array(residuals.buffer, residuals.byteOffset, residuals.byteLength);
  if (compressor === COMP_ZLIB) return zlibSync(raw, { level: 1 });
  // Brotli fixtures rely on the passthrough DecompressionStream stub: bytes go
  // in and come out unchanged, so the payload is stored uncompressed here.
  return raw.slice();
}

interface TileOptions {
  vmin: number;
  range: number;
  bits: number;
  predictor: number;
  compressor: number;
  residuals: Int16Array;
}

function buildTile(opts: TileOptions): ArrayBuffer {
  const head = buildHeader(opts.vmin, opts.range, opts.bits, opts.predictor, opts.compressor);
  const body = compressBody(opts.residuals, opts.compressor);
  const tile = new Uint8Array(head.length + body.length);
  tile.set(head, 0);
  tile.set(body, head.length);
  return tile.buffer;
}

/** Encode a grid of elevations into a complete OZT2 tile. */
function encodeTile(
  elev: Int16Array,
  height: number,
  width: number,
  opts: { vmin: number; range: number; bits: number; predictor: Predictor; compressor: number },
): ArrayBuffer {
  const quantized = quantize(elev, opts.vmin, opts.range, opts.bits);
  const residuals = encodeResiduals(quantized, height, width, opts.predictor);
  return buildTile({ ...opts, residuals });
}

function gridFrom(values: number[][], width: number): Int16Array {
  const out = new Int16Array(values.length * width);
  values.forEach((row, i) => { out.set(row, i * width); });
  return out;
}

/** Minimal passthrough stand-in for DecompressionStream("br"). */
class PassthroughDecompressionStream {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<ArrayBuffer>;

  constructor() {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    this.readable = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    this.writable = new WritableStream<ArrayBuffer>({
      write(chunk) {
        controller?.enqueue(new Uint8Array(chunk));
      },
      close() {
        controller?.close();
      },
    });
  }
}

beforeEach(() => {
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("decodeOZT2", () => {
  it("round-trips a lossless 16-bit tile with no predictor", async () => {
    const elev = gridFrom(
      [
        [10, -20, 0, 7],
        [32767, -32768, 5, -5],
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
      4,
    );
    const tile = encodeTile(elev, 4, 4, { vmin: 0, range: 0, bits: 16, predictor: PRED_NONE, compressor: COMP_ZLIB });

    const result = await decodeOZT2(tile);

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(Array.from(result.elevation)).toEqual(Array.from(elev));
    expect(result.metadata).toEqual({
      minElevation: 0,
      elevationRange: 0,
      maxElevation: 0,
      bitsPerPixel: 16,
      predictor: "none",
      compressor: "zlib",
      width: 4,
      height: 4,
    });
  });

  it("round-trips left-predicted residuals", async () => {
    const elev = gridFrom(
      [
        [100, 140, 90],
        [105, 300, 250],
        [99, 101, 400],
      ],
      3,
    );
    const tile = encodeTile(elev, 3, 3, { vmin: 0, range: 0, bits: 16, predictor: PRED_LEFT, compressor: COMP_ZLIB });

    const result = await decodeOZT2(tile);

    expect(Array.from(result.elevation)).toEqual([100, 140, 90, 105, 300, 250, 99, 101, 400]);
    expect(result.metadata.predictor).toBe("left");
  });

  it("round-trips gradient-predicted residuals", async () => {
    const elev = gridFrom(
      [
        [500, 520, 530, 515],
        [510, 545, 560, 540],
        [505, 530, 590, 600],
        [495, 500, 520, 545],
      ],
      4,
    );
    const tile = encodeTile(elev, 4, 4, { vmin: 0, range: 0, bits: 16, predictor: PRED_GRADIENT, compressor: COMP_ZLIB });

    const result = await decodeOZT2(tile);

    expect(Array.from(result.elevation)).toEqual(Array.from(elev));
    expect(result.metadata.predictor).toBe("gradient");
  });

  it("applies a negative min-elevation offset", async () => {
    const elev = Int16Array.from([-400, -300, -250, -100]);
    const tile = encodeTile(elev, 2, 2, { vmin: -400, range: 0, bits: 16, predictor: PRED_NONE, compressor: COMP_ZLIB });

    const result = await decodeOZT2(tile);

    expect(Array.from(result.elevation)).toEqual([-400, -300, -250, -100]);
    expect(result.metadata.minElevation).toBe(-400);
  });

  it("dequantizes 8-bit tiles", async () => {
    // range === vmax keeps scale at 1 m per level, so round trip is exact.
    const elev = gridFrom(
      [
        [1000, 1100, 1200, 1255],
        [1005, 1050, 1150, 1010],
        [1001, 1002, 1003, 1004],
        [1200, 1210, 1230, 1240],
      ],
      4,
    );
    const tile = encodeTile(elev, 4, 4, { vmin: 1000, range: 255, bits: 8, predictor: PRED_NONE, compressor: COMP_ZLIB });

    const result = await decodeOZT2(tile);

    expect(Array.from(result.elevation)).toEqual(Array.from(elev));
    expect(result.metadata).toMatchObject({
      minElevation: 1000,
      elevationRange: 255,
      maxElevation: 1255,
      bitsPerPixel: 8,
    });
  });

  it("fills a flat tile when the elevation range is zero at low bit depth", async () => {
    const residuals = Int16Array.from([200, 3, 4, 5]);
    const tile = buildTile({ vmin: 42, range: 0, bits: 8, predictor: PRED_NONE, compressor: COMP_ZLIB, residuals });

    const result = await decodeOZT2(tile);

    expect(Array.from(result.elevation)).toEqual([42, 42, 42, 42]);
  });

  it("infers non-square dimensions when the pixel count is not a perfect square", async () => {
    // 512 pixels is not a square but divides evenly by 256 -> 2 rows x 256 cols.
    const elev = new Int16Array(512).fill(7);
    const tile = encodeTile(elev, 2, 256, { vmin: 0, range: 0, bits: 16, predictor: PRED_LEFT, compressor: COMP_ZLIB });

    const result = await decodeOZT2(tile);

    expect(result.width).toBe(256);
    expect(result.height).toBe(2);
    expect(Array.from(result.elevation)).toEqual(Array.from(elev));
  });

  it("decodes brotli tiles through the native DecompressionStream", async () => {
    vi.stubGlobal("DecompressionStream", PassthroughDecompressionStream);
    const elev = Int16Array.from([11, 22, 33, 44]);
    const tile = encodeTile(elev, 2, 2, { vmin: 0, range: 0, bits: 16, predictor: PRED_NONE, compressor: COMP_BROTLI });

    const result = await decodeOZT2(tile);

    expect(Array.from(result.elevation)).toEqual([11, 22, 33, 44]);
    expect(result.metadata.compressor).toBe("brotli");
  });

  it("rejects a tile smaller than the header", async () => {
    await expect(decodeOZT2(new ArrayBuffer(5))).rejects.toThrow("Tile too small: 5 bytes (min 6)");
  });

  it.each([7, 17])("rejects bits_per_pixel of %i", async (bits) => {
    const tile = buildTile({ vmin: 0, range: 0, bits, predictor: PRED_NONE, compressor: COMP_ZLIB, residuals: new Int16Array(4) });
    await expect(decodeOZT2(tile)).rejects.toThrow(`Invalid bits_per_pixel: ${bits}`);
  });

  it("rejects an invalid predictor", async () => {
    const tile = buildTile({ vmin: 0, range: 0, bits: 16, predictor: 3, compressor: COMP_ZLIB, residuals: new Int16Array(4) });
    await expect(decodeOZT2(tile)).rejects.toThrow("Invalid predictor: 3");
  });

  it("rejects an invalid compressor", async () => {
    const tile = buildTile({ vmin: 0, range: 0, bits: 16, predictor: PRED_NONE, compressor: 3, residuals: new Int16Array(4) });
    await expect(decodeOZT2(tile)).rejects.toThrow("Invalid compressor: 3");
  });

  it("rejects zstd tiles with the documented edge-runtime message", async () => {
    const tile = buildTile({
      vmin: 0,
      range: 0,
      bits: 16,
      predictor: PRED_NONE,
      compressor: COMP_ZSTD,
      residuals: new Int16Array(4),
    });
    await expect(decodeOZT2(tile)).rejects.toThrow("ZSTD not supported in Edge. Use merged chunks fallback.");
  });

  it("rejects payloads that are not aligned to 2 bytes", async () => {
    // A 5-byte brotli body passes through the stubbed stream unchanged, so the
    // decoder sees an odd number of bytes.
    vi.stubGlobal("DecompressionStream", PassthroughDecompressionStream);
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const raw = new Uint8Array(HEADER_SIZE + payload.length);
    raw.set(buildHeader(0, 0, 16, PRED_NONE, COMP_BROTLI), 0);
    raw.set(payload, HEADER_SIZE);

    await expect(decodeOZT2(raw.buffer)).rejects.toThrow("Decompressed data not aligned to 2 bytes: 5");
  });

  it("rejects payloads whose pixel count yields no known tile shape", async () => {
    const residuals = Int16Array.from([1, 2, 3]);
    const tile = buildTile({ vmin: 0, range: 0, bits: 16, predictor: PRED_NONE, compressor: COMP_ZLIB, residuals });
    await expect(decodeOZT2(tile)).rejects.toThrow("Cannot infer tile dimensions from 3 pixels");
  });
});

describe("decodeOZT2Sync", () => {
  it("round-trips a gradient tile with a negative min elevation", () => {
    const elev = gridFrom(
      [
        [-40, -20, -5],
        [-30, -10, 15],
        [0, 25, 45],
      ],
      3,
    );
    const tile = encodeTile(elev, 3, 3, { vmin: -40, range: 0, bits: 16, predictor: PRED_GRADIENT, compressor: COMP_ZLIB });

    const result = decodeOZT2Sync(tile, unzlibSync);

    expect(Array.from(result.elevation)).toEqual(Array.from(elev));
    expect(result.metadata).toEqual({
      minElevation: -40,
      elevationRange: 0,
      maxElevation: -40,
      bitsPerPixel: 16,
      predictor: "gradient",
      compressor: "zlib",
      width: 3,
      height: 3,
    });
  });

  it("round-trips a non-square left-predicted tile at 8 bits", () => {
    // 128 residuals: not a perfect square, but 128 % 128 === 0 -> 1 row x 128 cols.
    const elev = new Int16Array(128).fill(10);
    elev[0] = 10;
    elev[1] = 20;
    elev[2] = 30;
    elev[3] = 40;
    elev[4] = 11;
    elev[5] = 21;
    elev[6] = 31;
    elev[7] = 41;
    const tile = encodeTile(elev, 1, 128, { vmin: 10, range: 255, bits: 8, predictor: PRED_LEFT, compressor: COMP_ZLIB });

    const result = decodeOZT2Sync(tile, unzlibSync);

    expect(result.width).toBe(128);
    expect(result.height).toBe(1);
    expect(Array.from(result.elevation)).toEqual(Array.from(elev));
  });

  it("rejects a tile smaller than the header", () => {
    expect(() => decodeOZT2Sync(new ArrayBuffer(2), unzlibSync)).toThrow("Tile too small: 2 bytes (min 6)");
  });

  it("requires an inflate function for zlib tiles", () => {
    const tile = buildTile({ vmin: 0, range: 0, bits: 16, predictor: PRED_NONE, compressor: COMP_ZLIB, residuals: new Int16Array(4) });
    expect(() => decodeOZT2Sync(tile)).toThrow("Provide inflateFn for zlib decode in workers.");
  });

  it("requires an inflate function for brotli tiles", () => {
    const tile = buildTile({ vmin: 0, range: 0, bits: 16, predictor: PRED_NONE, compressor: COMP_BROTLI, residuals: new Int16Array(4) });
    expect(() => decodeOZT2Sync(tile)).toThrow("Brotli sync decode requires fflate. Provide inflateFn.");
  });

  it("rejects zstd tiles", () => {
    const tile = buildTile({ vmin: 0, range: 0, bits: 16, predictor: PRED_NONE, compressor: COMP_ZSTD, residuals: new Int16Array(4) });
    expect(() => decodeOZT2Sync(tile, unzlibSync)).toThrow("Compressor 1 not supported in sync mode");
  });

  it("rejects payloads whose pixel count yields no known tile shape", () => {
    const residuals = Int16Array.from([1, 2, 3]);
    const tile = buildTile({ vmin: 0, range: 0, bits: 16, predictor: PRED_NONE, compressor: COMP_ZLIB, residuals });
    expect(() => decodeOZT2Sync(tile, unzlibSync)).toThrow("Cannot infer dimensions from 3 pixels");
  });
});

describe("interpolateElevation", () => {
  // 2x2 grid: values 100 (invalid/nodata) at (0,0), 200, 300, 400 elsewhere.
  const grid = Int16Array.from([-32768, 200, 300, 400]);

  it("bilinearly interpolates between four valid corners", () => {
    const all = Int16Array.from([100, 200, 300, 400]);
    // fx = 0.5, fy = 0.5 -> mean of the four corners.
    expect(interpolateElevation(all, 0.5, 0.5, 2, 2)).toBe(250);
    // fx = 0.25, fy = 0 -> 0.75 * 100 + 0.25 * 200 = 125
    expect(interpolateElevation(all, 0.25, 0, 2, 2)).toBe(125);
  });

  it("returns the exact cell at integer positions", () => {
    expect(interpolateElevation(grid, 1, 1, 2, 2)).toBe(400);
    expect(interpolateElevation(grid, 1, 0, 2, 2)).toBe(200);
  });

  it("clamps the sample window at the right and bottom edges", () => {
    const three = Int16Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // x = 2 is the last column: x1 clamps to 2, so only the y neighbours blend.
    expect(interpolateElevation(three, 2, 1.5, 3, 3)).toBe(7.5);
    // Both coordinates on the last row/column collapse to the corner value.
    expect(interpolateElevation(three, 2, 2, 3, 3)).toBe(9);
    const all = Int16Array.from([100, 200, 300, 400]);
    expect(interpolateElevation(all, 1.75, 1.25, 2, 2)).toBe(400);
  });

  it("returns nodata when every corner is nodata", () => {
    const empty = new Int16Array(4).fill(-32768);
    expect(interpolateElevation(empty, 0.5, 0.5, 2, 2)).toBe(-32768);
  });

  it("falls back to the rounded cell when a corner is nodata", () => {
    // Rounded position (1,1) is valid -> 400 despite the nodata corner at (0,0).
    expect(interpolateElevation(grid, 0.6, 0.6, 2, 2)).toBe(400);
  });

  it("returns nodata when the rounded cell itself is nodata", () => {
    expect(interpolateElevation(grid, 0.2, 0.2, 2, 2)).toBe(-32768);
  });

  it("honours a custom nodata sentinel", () => {
    const sentinel = Int16Array.from([-9999, 200, 300, 400]);
    expect(interpolateElevation(sentinel, 0.2, 0.2, 2, 2, -9999)).toBe(-9999);
    const blank = new Int16Array(4).fill(-9999);
    expect(interpolateElevation(blank, 0.5, 0.5, 2, 2, -9999)).toBe(-9999);
    const valid = Int16Array.from([100, 200, 300, 400]);
    expect(interpolateElevation(valid, 0.5, 0.5, 2, 2, -1)).toBe(250);
  });
});
