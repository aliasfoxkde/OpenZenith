/**
 * Tests for src/lib/storage/local-tif-backend.ts.
 *
 * A minimal tiled GeoTIFF is synthesised in a tmp directory (II and MM byte
 * orders, full and partial edge tiles) so the IFD parser, zlib inflate and
 * 256x256 window extraction are all exercised against real bytes.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deflateSync, inflateSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalTifBackend, LOCAL_BACKEND } from "@/lib/storage/local-tif-backend";

const TILE = 256;
const TILE_PIXELS = TILE * TILE;

interface TiffOptions {
  littleEndian: boolean;
  width: number;
  height: number;
  /** Omit to leave tag 322 (TileWidth) out of the IFD. */
  tileWidth?: number;
  /** Omit to leave tag 323 (TileLength) out of the IFD. */
  tileHeight?: number;
  /** Force a non-single count on one IFD tag, as multi-value tags have. */
  countOverride?: { tag: number; count: number };
  /** Omit to leave tag 324 (TileOffsets) out of the IFD. */
  includeTileOffsets?: boolean;
  /** One raw interleaved Int16 pixel plane per tile; stored deflate-compressed. */
  planes?: Int16Array[];
  /** Verbatim tile payload, used to simulate corrupt tile data. */
  rawTileData?: Uint8Array;
  /** Append bytes after the final tile, as real SRTM files do. */
  trailingBytes?: number;
}

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  value: number;
}

function tilePlane(seed: number): Int16Array {
  const pixels = new Int16Array(TILE_PIXELS);
  for (let i = 0; i < TILE_PIXELS; i++) {
    pixels[i] = ((i * 7 + seed * 31) % 2000) - 1000;
  }
  return pixels;
}

function buildTiff(options: TiffOptions): Buffer {
  const le = options.littleEndian;
  const payloads = options.rawTileData
    ? [options.rawTileData]
    : (options.planes ?? []).map((plane) => plane.buffer.slice(plane.byteOffset, plane.byteOffset + plane.byteLength));
  const compressed = options.rawTileData
    ? [Buffer.from(options.rawTileData)]
    : payloads.map((payload) => deflateSync(new Uint8Array(payload as ArrayBuffer), { level: 6 }));

  const entries: TiffEntry[] = [
    { tag: 256, type: 4, count: 1, value: options.width },
    { tag: 257, type: 4, count: 1, value: options.height },
  ];
  if (options.tileWidth !== undefined) entries.push({ tag: 322, type: 4, count: 1, value: options.tileWidth });
  if (options.tileHeight !== undefined) entries.push({ tag: 323, type: 4, count: 1, value: options.tileHeight });
  if (options.includeTileOffsets !== false) {
    entries.push({ tag: 324, type: 4, count: compressed.length, value: 0 });
  }

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const offsetsOffset = ifdOffset + ifdSize;
  const dataStart = offsetsOffset + compressed.length * 4;

  // Tag 324's value is a pointer to the offsets array written just after the IFD.
  const offsetsEntry = entries.find((entry) => entry.tag === 324);
  if (offsetsEntry) offsetsEntry.value = offsetsOffset;
  if (options.countOverride) {
    const target = entries.find((entry) => entry.tag === options.countOverride?.tag);
    if (target) target.count = options.countOverride.count;
  }

  let cursor = dataStart;
  const tileOffsets = compressed.map((chunk: Buffer) => {
    const offset = cursor;
    cursor += chunk.length;
    return offset;
  });
  const trailing = options.trailingBytes ?? 0;
  const buf = Buffer.alloc(cursor + trailing);

  const u16 = (offset: number, value: number) =>
    le ? buf.writeUInt16LE(value, offset) : buf.writeUInt16BE(value, offset);
  const u32 = (offset: number, value: number) =>
    le ? buf.writeUInt32LE(value, offset) : buf.writeUInt32BE(value, offset);

  // Header: byte order indicator, magic 42, IFD offset.
  buf[0] = le ? 0x49 : 0x4d;
  buf[1] = le ? 0x49 : 0x4d;
  u16(2, 42);
  u32(4, ifdOffset);

  u16(ifdOffset, entries.length);
  entries.forEach((entry, index) => {
    const base = ifdOffset + 2 + index * 12;
    u16(base, entry.tag);
    u16(base + 2, entry.type);
    u32(base + 4, entry.count);
    u32(base + 8, entry.value);
  });
  u32(ifdOffset + 2 + entries.length * 12, 0); // no further IFD

  tileOffsets.forEach((offset, index) => u32(offsetsOffset + index * 4, offset));
  compressed.forEach((chunk, index) => chunk.copy(buf, tileOffsets[index]));
  if (trailing > 0) buf.fill(0x1a, cursor);

  return buf;
}

function decodeChunk(chunk: ArrayBuffer): Int16Array {
  const raw = inflateSync(Buffer.from(chunk));
  return new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
}

/**
 * Mirror of the source's padded window extraction: real pixels are stored at
 * stride 256; the region beyond the image edge stays zero, matching the
 * padded OZCHNK01 layout so the decoder's predictor runs at stride 256.
 */
function expectedWindow(pixels: Int16Array, tileWidth: number, outRows: number, outCols: number): Int16Array {
  const out = new Int16Array(TILE_PIXELS);
  for (let row = 0; row < outRows; row++) {
    for (let col = 0; col < outCols; col++) {
      out[row * TILE + col] = pixels[row * tileWidth + col];
    }
  }
  return out;
}

function expectInt16Equal(actual: Int16Array, expected: Int16Array): void {
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

function expectEmpty(chunk: ArrayBuffer): void {
  expect(chunk).toBeInstanceOf(ArrayBuffer);
  expect(chunk.byteLength).toBe(0);
}

let dataDir = "";
let backend: LocalTifBackend;

async function writeTiff(name: string, contents: Buffer): Promise<void> {
  await writeFile(path.join(dataDir, name), contents);
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "oz-tif-"));
  backend = new LocalTifBackend(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("LocalTifBackend.fetchChunk", () => {
  it("returns the requested 256x256 chunk from a tiled GeoTIFF", async () => {
    const planes = [tilePlane(1), tilePlane(2), tilePlane(3), tilePlane(4)];
    await writeTiff("N40W074.tif", buildTiff({ littleEndian: true, width: 512, height: 512, tileWidth: TILE, tileHeight: TILE, planes }));

    const decoded = decodeChunk(await backend.fetchChunk("N40W074.tif", 0, 0));

    expect(decoded.length).toBe(TILE_PIXELS);
    expectInt16Equal(decoded, expectedWindow(planes[0], TILE, TILE, TILE));
  });

  it("reads the final tile using end-of-file as its upper bound", async () => {
    const planes = [tilePlane(1), tilePlane(2), tilePlane(3), tilePlane(9)];
    await writeTiff("N00E000.tif", buildTiff({ littleEndian: true, width: 512, height: 512, tileWidth: TILE, tileHeight: TILE, planes, trailingBytes: 16 }));

    const decoded = decodeChunk(await backend.fetchChunk("N00E000.tif", 1, 1));

    expectInt16Equal(decoded, expectedWindow(planes[3], TILE, TILE, TILE));
  });

  it("pads a partial edge tile to the stored 256px width", async () => {
    const planes = [tilePlane(1), tilePlane(11), tilePlane(3), tilePlane(4)];
    await writeTiff("N47E008.tif", buildTiff({ littleEndian: true, width: 300, height: 300, tileWidth: TILE, tileHeight: TILE, planes }));

    const decoded = decodeChunk(await backend.fetchChunk("N47E008.tif", 0, 1));

    expect(decoded.length).toBe(TILE_PIXELS);
    expectInt16Equal(decoded, expectedWindow(planes[1], TILE, TILE, 300 - TILE));
    // The 212 padded columns per row decode to zero, exactly as the
    // HuggingFace merged files pad their edge chunks.
    const realWidth = 300 - TILE;
    const paddedCols = Array.from(decoded).filter((_, i) => i % TILE >= realWidth);
    expect(paddedCols).toHaveLength(TILE * (TILE - realWidth));
    expect(paddedCols.every((v) => v === 0)).toBe(true);
  });

  it("pads the bottom-right partial tile on both axes", async () => {
    const planes = [tilePlane(1), tilePlane(2), tilePlane(3), tilePlane(12)];
    await writeTiff("N47E008.tif", buildTiff({ littleEndian: true, width: 300, height: 300, tileWidth: TILE, tileHeight: TILE, planes }));

    const decoded = decodeChunk(await backend.fetchChunk("N47E008.tif", 1, 1));

    expect(decoded.length).toBe(TILE_PIXELS);
    expectInt16Equal(decoded, expectedWindow(planes[3], TILE, 300 - TILE, 300 - TILE));
    // Rows past the real 44 carry nothing but padding.
    expect(Array.from(decoded.slice((300 - TILE) * TILE)).every((v) => v === 0)).toBe(true);
  });

  it("parses big-endian (MM) GeoTIFFs", async () => {
    const planes = [tilePlane(21), tilePlane(22), tilePlane(23), tilePlane(24)];
    await writeTiff("N10W010.tif", buildTiff({ littleEndian: false, width: 512, height: 512, tileWidth: TILE, tileHeight: TILE, planes }));

    const decoded = decodeChunk(await backend.fetchChunk("N10W010.tif", 0, 1));

    expectInt16Equal(decoded, expectedWindow(planes[1], TILE, TILE, TILE));
  });

  it("defaults the tile size to 256 when the tile tags are absent", async () => {
    const planes = [tilePlane(31)];
    await writeTiff("N51E000.tif", buildTiff({ littleEndian: true, width: 256, height: 256, planes }));

    const decoded = decodeChunk(await backend.fetchChunk("N51E000.tif", 0, 0));

    expect(decoded.length).toBe(TILE_PIXELS);
    expectInt16Equal(decoded, expectedWindow(planes[0], TILE, TILE, TILE));
  });

  it("returns an empty buffer for a chunk outside the tile grid", async () => {
    const planes = [tilePlane(1), tilePlane(2), tilePlane(3), tilePlane(4)];
    await writeTiff("N40W074.tif", buildTiff({ littleEndian: true, width: 512, height: 512, tileWidth: TILE, tileHeight: TILE, planes }));

    expectEmpty(await backend.fetchChunk("N40W074.tif", 5, 0));
    expectEmpty(await backend.fetchChunk("N40W074.tif", 0, 5));
  });

  it("returns an empty buffer when the file is missing", async () => {
    expectEmpty(await backend.fetchChunk("ZZ9ZZ999.tif", 0, 0));
  });

  it("returns an empty buffer when the header is truncated", async () => {
    await writeTiff("short.tif", Buffer.from([0x49, 0x49, 0x2a, 0x00]));

    expectEmpty(await backend.fetchChunk("short.tif", 0, 0));
  });

  it("returns an empty buffer when the tile offsets tag is absent", async () => {
    const planes = [tilePlane(1)];
    await writeTiff("nooffsets.tif", buildTiff({ littleEndian: true, width: 256, height: 256, planes, includeTileOffsets: false }));

    expectEmpty(await backend.fetchChunk("nooffsets.tif", 0, 0));
  });

  it.each([256, 257])("returns an empty buffer when tag %i carries a non-single count", async (tag) => {
    const planes = [tilePlane(1)];
    await writeTiff(
      "badcount.tif",
      buildTiff({ littleEndian: true, width: 256, height: 256, tileWidth: TILE, tileHeight: TILE, planes, countOverride: { tag, count: 2 } }),
    );

    expectEmpty(await backend.fetchChunk("badcount.tif", 0, 0));
  });

  it.each([322, 323])("falls back to a 256px tile when tag %i carries a non-single count", async (tag) => {
    const planes = [tilePlane(41)];
    await writeTiff(
      "badtilesize.tif",
      buildTiff({ littleEndian: true, width: 256, height: 256, tileWidth: TILE, tileHeight: TILE, planes, countOverride: { tag, count: 2 } }),
    );

    const decoded = decodeChunk(await backend.fetchChunk("badtilesize.tif", 0, 0));
    expect(decoded.length).toBe(TILE_PIXELS);
    expectInt16Equal(decoded, expectedWindow(planes[0], TILE, TILE, TILE));
  });

  it("returns an empty buffer when the tile is not a zlib stream", async () => {
    await writeTiff("junk.tif", buildTiff({ littleEndian: true, width: 256, height: 256, tileWidth: TILE, tileHeight: TILE, rawTileData: Buffer.alloc(64, 0x55) }));

    expectEmpty(await backend.fetchChunk("junk.tif", 0, 0));
  });
});

describe("LOCAL_BACKEND singleton", () => {
  it("is a LocalTifBackend over the repository DEM directory", async () => {
    // The tile is deliberately absent; the call must resolve to an empty
    // ArrayBuffer rather than reject, whatever the directory contains.
    const chunk = await LOCAL_BACKEND.fetchChunk("ZZ9ZZ999.tif", 0, 0);

    expect(chunk).toBeInstanceOf(ArrayBuffer);
    expect(chunk.byteLength).toBe(0);
    expect(LOCAL_BACKEND).toBeInstanceOf(LocalTifBackend);
  });
});
