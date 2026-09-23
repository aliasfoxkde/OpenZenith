import { vi } from "vitest";
import { zlibSync } from "fflate";
import { chunkRealExtent, MERGED_CHUNK_STRIDE } from "../srtm/merged-parser";
import type { ChunkBackend } from "../storage/backend";

/**
 * Shared fixtures for the tile assemblers' test suites (tile.test.ts,
 * tile-crs84.test.ts).
 *
 * The assemblers' two I/O boundaries are replaced here: global fetch serves
 * hand-built Terrarium PNGs, and chunk storage serves hand-built deflate
 * chunks with the TIFF horizontal predictor already applied.
 */

export const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Forward PNG row filter: produce the stored row for a target scanline. */
function filterRow(target: Uint8Array, prev: Uint8Array, bpp: number, type: number): Uint8Array {
  const out = new Uint8Array(target.length);
  for (let i = 0; i < target.length; i++) {
    const a = i >= bpp ? target[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let value: number;
    if (type === 1) value = target[i] - a;
    else if (type === 2) value = target[i] - b;
    else if (type === 3) value = target[i] - ((a + b) >> 1);
    else if (type === 4) value = target[i] - paethPredictor(a, b, c);
    else value = target[i]; // 0 (None) and any unrecognised type are stored raw
    out[i] = value & 0xff;
  }
  return out;
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  new DataView(chunk.buffer).setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  new DataView(chunk.buffer).setUint32(8 + data.length, crc32(crcInput));
  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface PngOptions {
  width: number;
  height: number;
  /** PNG colour type: 2 = RGB, 6 = RGBA, 0 = grayscale. */
  colorType: number;
  /** Per-row filter type; rows without an entry use filter 0. */
  filters?: number[];
  /** Split the compressed stream across this many IDAT chunks. */
  idatChunks?: number;
  pixel: (x: number, y: number) => [number, number, number];
}

/** Build an IHDR payload: width, height, 8-bit depth, given colour type. */
export function ihdrFor(width: number, height: number, colorType: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  return ihdr;
}

export function buildTerrariumPNG(opts: PngOptions): ArrayBuffer {
  const bpp = opts.colorType === 2 ? 3 : opts.colorType === 6 ? 4 : opts.colorType === 0 ? 1 : 3;
  const stride = opts.width * bpp;
  const raw = new Uint8Array(opts.height * (1 + stride));
  let prev = new Uint8Array(stride);

  for (let y = 0; y < opts.height; y++) {
    const target = new Uint8Array(stride);
    for (let x = 0; x < opts.width; x++) {
      const [r, g, b] = opts.pixel(x, y);
      const at = x * bpp;
      target[at] = r;
      if (bpp > 1) target[at + 1] = g;
      if (bpp > 2) target[at + 2] = b;
      if (bpp > 3) target[at + 3] = 255;
    }

    const filter = opts.filters?.[y] ?? 0;
    const rowStart = y * (1 + stride);
    raw[rowStart] = filter;
    raw.set(filterRow(target, prev, bpp, filter), rowStart + 1);
    prev = target;
  }

  const compressed = zlibSync(raw, { level: 1 });
  const ihdr = ihdrFor(opts.width, opts.height, opts.colorType);

  // Split IDAT across equally sized pieces (the last one keeps the remainder).
  const pieces = Math.max(1, opts.idatChunks ?? 1);
  const size = Math.floor(compressed.length / pieces);
  const idats: Uint8Array[] = [];
  for (let i = 0; i < pieces; i++) {
    const start = i * size;
    const end = i === pieces - 1 ? compressed.length : start + size;
    idats.push(compressed.subarray(start, end));
  }

  const chunks = [
    pngChunk("IHDR", ihdr),
    ...idats.map((data) => pngChunk("IDAT", data)),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = PNG_SIGNATURE.length + chunks.reduce((sum, c) => sum + c.length, 0);
  const png = new Uint8Array(total);
  png.set(PNG_SIGNATURE, 0);
  let offset = PNG_SIGNATURE.length;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png.buffer;
}

/** Terrarium decoding: height_m = R*256 + G + B/256 - 32768. */
export function terrariumElevation(r: number, g: number, b: number): number {
  const enc = r * 256 + g + b / 256;
  return enc === 0 ? -32768 : Math.round(enc - 32768);
}

export function awsResponse(png: ArrayBuffer): Response {
  // `arrayBuffer` returns the buffer directly; the assembler awaits the call, so
  // the value is resolved identically without an async wrapper.
  return { ok: true, arrayBuffer: () => png } as unknown as Response;
}

// ─── SRTM chunk fixtures ──────────────────────────────────────────────────────

/**
 * Build one stored chunk the way real producers store it: always 256x256
 * (edge chunks pad with zero deltas), zlib-compressed int16 row differences
 * (TIFF predictor 2), so a constant elevation is encoded as the absolute
 * value in column 0 followed by zeros. `elevation` is only queried for the
 * chunk's real (non-padding) extent.
 */
export function buildChunk(
  elevation: (localRow: number, localCol: number) => number,
  chunkRow: number,
  chunkCol: number,
): ArrayBuffer {
  const stride = MERGED_CHUNK_STRIDE;
  const { width, height } = chunkRealExtent(chunkRow, chunkCol);
  const raw = new Int16Array(stride * stride); // zero padding beyond the real extent
  for (let r = 0; r < height; r++) {
    raw[r * stride] = elevation(r, 0);
    for (let c = 1; c < width; c++) {
      raw[r * stride + c] = elevation(r, c) - elevation(r, c - 1);
    }
  }
  return zlibSync(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), { level: 1 }).slice().buffer;
}

/** Storage that synthesises every requested chunk at a fixed elevation. */
export function constantStorage(elevation: (srtmName: string, localRow: number, localCol: number) => number): ChunkBackend {
  return {
    fetchChunk: vi.fn(
      (srtmName: string, row: number, col: number): Promise<ArrayBuffer> =>
        Promise.resolve(buildChunk((r, c) => elevation(srtmName, r, c), row, col)),
    ),
  };
}

export function failingStorage(message: string): ChunkBackend {
  return { fetchChunk: vi.fn(async (): Promise<ArrayBuffer> => Promise.reject(new Error(message))) };
}

/** Replace global fetch with a URL -> Response handler. */
export function stubFetch(handler: (url: string) => Response | null): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((url: string) => handler(url));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
