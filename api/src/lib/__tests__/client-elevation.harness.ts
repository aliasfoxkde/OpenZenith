/**
 * Shared fixtures for the client-elevation suite.
 *
 * The `client-elevation` module reaches three upstreams — HuggingFace
 * (`.merged` SRTM chunks), CEDA (GEBCO GeoTIFF strips) and this project's own
 * `/api/elevation` endpoints. The builders below mint byte-exact fixtures for
 * each of them and a single `fetch` router that serves them, so the suites
 * assert on decoding and fallback behaviour without touching the network.
 *
 * Every suite imports this module FIRST and installs its own fixtures per
 * test; `vi.stubGlobal("fetch", …)` is undone by the `afterEach` hook below,
 * which is file-scoped to whichever suite imported the harness.
 */

import { vi, afterEach } from "vitest";
import { zlibSync } from "fflate";

/* ─── fixture builders: OZCHNK01 merged files and GEBCO strips ─── */

const MERGED_MAGIC = [0x4f, 0x5a, 0x43, 0x48, 0x4e, 0x4b, 0x30, 0x31]; // "OZCHNK01"
const HEADER_SIZE = 12;
const INDEX_ENTRY_SIZE = 8;

/**
 * Predictor-encode and zlib-compress one 256x256 (or 17px remainder) chunk.
 * The reader undoes horizontal differencing, so `valueAt` is the real elevation grid.
 */
export function chunkPayload(valueAt: (row: number, col: number) => number, width: number, height: number): Uint8Array {
  const raw = new Int16Array(width * height);
  for (let r = 0; r < height; r++) {
    let prev = 0;
    for (let c = 0; c < width; c++) {
      const decoded = valueAt(r, c) | 0;
      raw[r * width + c] = (decoded - prev) | 0;
      prev = decoded;
    }
  }
  return zlibSync(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
}

/**
 * Build a merged file: 8 byte magic, uint16 version, rows, cols, then an
 * offset/size index for rows*cols chunks, then the concatenated payloads.
 * Slots without a payload get offset 0 / size 0, which decodes to "no chunk".
 */
export function mergedFile(payloads: Array<{ slot: number; data: Uint8Array }>, rows: number, cols: number): Uint8Array {
  const entryCount = rows * cols;
  const dataStart = HEADER_SIZE + entryCount * INDEX_ENTRY_SIZE;
  const placed = new Map<number, { offset: number; size: number }>();
  let cursor = dataStart;
  for (const payload of payloads) {
    placed.set(payload.slot, { offset: cursor, size: payload.data.length });
    cursor += payload.data.length;
  }

  const out = new Uint8Array(cursor);
  out.set(MERGED_MAGIC);
  const view = new DataView(out.buffer);
  view.setUint16(8, 1, true); // version 1 = SRTM Int16
  out[10] = rows;
  out[11] = cols;
  for (let i = 0; i < entryCount; i++) {
    const entry = placed.get(i);
    view.setUint32(HEADER_SIZE + i * INDEX_ENTRY_SIZE, entry ? entry.offset : 0, true);
    view.setUint32(HEADER_SIZE + i * INDEX_ENTRY_SIZE + 4, entry ? entry.size : 0, true);
  }
  for (const payload of payloads) {
    out.set(payload.data, (placed.get(payload.slot) as { offset: number }).offset);
  }
  return out;
}

/**
 * Chunk slot (row-major) inside a 15x15 SRTM chunk grid.
 */
export function slot(row: number, col: number, cols = 15): number {
  return row * cols + col;
}

/**
 * Write one little-endian Int16 sample at `col` into a GEBCO strip.
 */
export function writeInt16(strip: Uint8Array, col: number, value: number): void {
  const unsigned = value < 0 ? 65536 + value : value;
  strip[col * 2] = unsigned & 0xff;
  strip[col * 2 + 1] = Math.floor(unsigned / 256) & 0xff;
}

/**
 * A GEBCO strip buffer carrying a single sample at `col` — everything else
 * stays zero, so a test can read exactly the column it sampled.
 */
export function stripFor(col: number, value: number): Uint8Array {
  const strip = new Uint8Array(21600 * 2);
  writeInt16(strip, col, value);
  return strip;
}

/* ─── fetch router ─── */

/**
 * HuggingFace layout: `.../resolve/main/<latDir>/<tileBase>.merged`.
 */
export const HF_MERGED = /resolve\/main\/[NS]\d\d\/([NS]\d\d[EW]\d\d\d)\.merged$/;

/**
 * CEDA layout: `.../geotiff/<gebco tile name>.tif`.
 */
export const CEDA_STRIP = /geotiff\/(gebco_2025_\S+\.tif)$/;

/**
 * One URL the code under test fetched, with the Range header it sent.
 */
export interface RecordedCall {
  url: string;
  range: string | null;
}

/**
 * The upstream responses the fetch router should serve.
 */
export interface Fixtures {
  /** tile base (e.g. "N41W074") -> merged bytes, or an HTTP status to fail with */
  merged?: Record<string, Uint8Array | number>;
  /** fallback for tile bases not listed in `merged` */
  mergedFor?: (tileBase: string) => Uint8Array | number | undefined;
  /** tile bases whose fetch should reject outright (network failure) */
  mergedThrows?: string[];
  /** quadrant file name -> strip bytes, or an HTTP status to fail with */
  strips?: Record<string, Uint8Array | number>;
  /** quadrant file names served with status 200 (range ignored) instead of 206 */
  stripsAt200?: Record<string, Uint8Array>;
  /** quadrant file names whose fetch should reject outright */
  stripsThrows?: string[];
  pointEndpoint?: (url: string) => Response;
  batchEndpoint?: (url: string) => Response;
}

/**
 * Install the fetch router and stub `globalThis.fetch` with it.
 *
 * Returns the log of every call the code under test made, so a suite can
 * assert on which upstream was consulted and with which Range header.
 */
export function installFixtures(fixtures: Fixtures = {}): { calls: RecordedCall[]; fetchMock: ReturnType<typeof vi.fn> } {
  const calls: RecordedCall[] = [];
  // Callers under test `await fetch(...)`, so a synchronous Response resolves
  // exactly like the real fetch's Promise<Response>.
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Response => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const range = init?.headers ? new Headers(init.headers).get("Range") : null;
    calls.push({ url, range });

    const merged = url.match(HF_MERGED);
    if (merged) {
      // bounds: HF_MERGED has one capture group, defined on any match
      if (fixtures.mergedThrows?.includes(merged[1]!)) throw new Error("hf offline");
      const entry = fixtures.merged?.[merged[1]!] ?? fixtures.mergedFor?.(merged[1]!);
      if (entry instanceof Uint8Array) return new Response(entry as unknown as BodyInit, { status: 200 });
      return new Response(null, { status: typeof entry === "number" ? entry : 404 });
    }

    const strip = url.match(CEDA_STRIP);
    if (strip) {
      // bounds: CEDA_STRIP has one capture group, defined on any match
      if (fixtures.stripsThrows?.includes(strip[1]!)) throw new Error("ceda offline");
      const at200 = fixtures.stripsAt200?.[strip[1]!];
      if (at200) return new Response(at200 as unknown as BodyInit, { status: 200 });
      const entry = fixtures.strips?.[strip[1]!];
      if (entry instanceof Uint8Array) return new Response(entry as unknown as BodyInit, { status: 206 });
      return new Response(null, { status: typeof entry === "number" ? entry : 404 });
    }

    if (url.includes("/api/elevation/batch")) {
      return fixtures.batchEndpoint ? fixtures.batchEndpoint(url) : new Response(null, { status: 500 });
    }
    if (url.includes("/api/elevation")) {
      return fixtures.pointEndpoint ? fixtures.pointEndpoint(url) : new Response(null, { status: 500 });
    }
    return new Response(null, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

/**
 * A JSON `Response` with the content type the real endpoints send.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * A single 256x256 chunk in slot (0,0) holding 100 + row + col.
 */
export function mergedWithLinearChunk0(): Uint8Array {
  return mergedFile([{ slot: slot(0, 0), data: chunkPayload((r, c) => 100 + r + c, 256, 256) }], 15, 15);
}

/**
 * Chunks of one SRTM tile whose decoded value is 100 + tileRow + tileCol,
 * where tileRow/tileCol are pixel coordinates inside the whole 3601x3601 tile.
 * Edge chunks are stored 256x256 with zero-delta padding, like the real files.
 */
export function linearTileChunks(coords: Array<[number, number]>): Array<{ slot: number; data: Uint8Array }> {
  return coords.map(([cr, cc]) => ({
    slot: slot(cr, cc),
    data: chunkPayload((r, c) => 100 + cr * 256 + r + cc * 256 + c, 256, 256),
  }));
}

/**
 * A merged file whose slot (0,0) decodes to the same value in every cell.
 */
export function mergedWithFlatChunk0(value: number): Uint8Array {
  return mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => value, 256, 256) }], 15, 15);
}

/**
 * The SRTM nodata sentinel the client module writes into unfilled cells.
 */
export const NODATA = -32768;

afterEach(() => {
  vi.unstubAllGlobals();
});
