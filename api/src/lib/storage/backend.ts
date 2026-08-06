/**
 * Chunk-based storage backend for pre-extracted DEM tiles.
 *
 * Supports two file formats:
 * 1. Individual .deflate chunks (one 256x256 chunk per file)
 * 2. Merged .merged files (all chunks for one tile in one file)
 *
 * URL patterns:
 *   Individual: {base}/{base}_{row:02d}_{col:02d}.deflate
 *   Merged:     {base}/{base}.merged
 */

import {
  parseMergedHeader,
  extractChunkFromMerged,
  getLatDir,
  getTileBase,
  type MergedIndex,
} from "@/lib/srtm/merged-parser";
import { cacheGet, cachePut } from "./cache";

export interface ChunkBackend {
  /** Fetch a single 256x256 chunk by SRTM tile name and grid position. */
  fetchChunk(srtmName: string, row: number, col: number): Promise<ArrayBuffer>;
}

// --- Cache for merged files ---

const mergedFileCache = new Map<string, { data: Uint8Array; index: MergedIndex; timestamp: number }>();
const MERGED_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (SRTM data is static)

// --- Implementations ---

abstract class BaseChunkBackend implements ChunkBackend {
  constructor(protected tryMerged: boolean) {}

  abstract buildUrl(path: string): string;

  private async fetchMergedFile(srtmName: string): Promise<{ data: Uint8Array; index: MergedIndex } | null> {
    const cacheKey = `oz:merged:${srtmName}`;

    // Try CF Cache API / in-memory cache first
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        const data = new Uint8Array(cached);
        const index = parseMergedHeader(data);
        if (index) return { data, index };
      }
    } catch {
      // Cache miss or unavailable
    }

    // In-memory cache (separate from CF Cache — fast lookup for same-isolate hits)
    const memCached = mergedFileCache.get(srtmName);
    if (memCached && Date.now() - memCached.timestamp < MERGED_CACHE_TTL) {
      return { data: memCached.data, index: memCached.index };
    }

    const latDir = getLatDir(srtmName);
    const base = getTileBase(srtmName);
    const url = this.buildUrl(`${latDir}/${base}.merged`);

    // Timeout HuggingFace fetches to avoid CPU limit on cold starts
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return null;

      const buffer = await response.arrayBuffer();
      const data = new Uint8Array(buffer);
      const index = parseMergedHeader(data);
      if (!index) return null;

      mergedFileCache.set(srtmName, { data, index, timestamp: Date.now() });

      // Store in CF Cache / in-memory cache for cross-isolate persistence
      cachePut(cacheKey, buffer).catch(() => {});

      return { data, index };
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  async fetchChunk(srtmName: string, row: number, col: number): Promise<ArrayBuffer> {
    // Try merged file first
    if (this.tryMerged) {
      const merged = await this.fetchMergedFile(srtmName);
      if (merged) {
        const chunk = extractChunkFromMerged(merged.data, merged.index, row, col);
        return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
      }
    }

    // Fall back to individual .deflate file
    const latDir = getLatDir(srtmName);
    const base = getTileBase(srtmName);
    const rowStr = String(row).padStart(2, "0");
    const colStr = String(col).padStart(2, "0");
    const url = this.buildUrl(`${latDir}/${base}_${rowStr}_${colStr}.deflate`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`Chunk not found: ${srtmName} row=${row} col=${col} (${response.status})`);
    }
    return response.arrayBuffer();
  }
}

export class HuggingFaceChunkBackend extends BaseChunkBackend {
  constructor(
    private repo: string,
    tryMerged: boolean,
  ) {
    super(tryMerged);
  }

  buildUrl(path: string): string {
    return `https://huggingface.co/datasets/${this.repo}/resolve/main/${path}`;
  }
}

// ─── Local SRTM .tif file backend ────────────────────────────────────────────
//
// File format: GeoTIFF with Deflate-compressed tiles (tag 322=256, tag 323=256).
// Tiles are stored sequentially in the file at byte offsets given by tag 324.
// Each tile is a raw Deflate stream (zlib header 0x78 0x9c).
// No byte-count prefix — inflateSync reads to natural zlib stream end.
//
// Layout per tile (3601×3601 image, 15×15 = 225 tiles of 256×256 each):
//   predictor tag=317 → type 2 = horizontal differencing (same as merged format)
//   First pixel of each row is the absolute value; rest are deltas.
//
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal GeoTIFF header parser for tiled SRTM .tif files. */
async function parseGeoTiffHeader(
  fd: number,
): Promise<{
  width: number;
  height: number;
  tileOffsets: number[]; // array of byte offsets, one per tile
  tileW: number;
  tileH: number;
} | null> {
  const header = Buffer.alloc(8);
  const { readFile } = await import("node:fs/promises");
  await readFile(fd, header, 0, 8, 0);

  const isLE = header[0] === 0x49 && header[1] === 0x49;
  const readU16 = (b: number) =>
    isLE ? header[b] | (header[b + 1] << 8) : (header[b] << 8) | header[b + 1];
  const readU32 = (b: number) =>
    isLE
      ? header[b] | (header[b + 1] << 8) | (header[b + 2] << 16) | (header[b + 3] << 24)
      : (header[b] << 24) | (header[b + 1] << 16) | (header[b + 2] << 8) | header[b + 3];

  if (readU16(2) !== 42) return null; // TIFF magic

  const ifdOffset = readU32(4);
  const numEntries = isLE
    ? header[ifdOffset] | (header[ifdOffset + 1] << 8)
    : (header[ifdOffset] << 8) | header[ifdOffset + 1];

  // IFD entries start at ifdOffset+2 (after numEntries uint16)
  const IFD_ENTRY = 12; // bytes per entry
  const ifdBuf = Buffer.alloc(numEntries * IFD_ENTRY);
  await readFile(fd, ifdBuf, 0, numEntries * IFD_ENTRY, ifdOffset + 2);

  let width = 0,
    height = 0,
    tileOffsetsOffset = 0,
    tileOffsetsCount = 0,
    tileW = 0,
    tileH = 0;

  for (let i = 0; i < numEntries; i++) {
    const b = i * IFD_ENTRY;
    const tag = isLE ? ifdBuf[b] | (ifdBuf[b + 1] << 8) : (ifdBuf[b] << 8) | ifdBuf[b + 1];
    const type = isLE ? ifdBuf[b + 2] | (ifdBuf[b + 3] << 8) : (ifdBuf[b + 2] << 8) | ifdBuf[b + 3];
    const count = isLE
      ? ifdBuf[b + 4] | (ifdBuf[b + 5] << 8) | (ifdBuf[b + 6] << 16) | (ifdBuf[b + 7] << 24)
      : (ifdBuf[b + 4] << 24) | (ifdBuf[b + 5] << 16) | (ifdBuf[b + 6] << 8) | ifdBuf[b + 7];
    const valOrOff = isLE
      ? ifdBuf[b + 8] | (ifdBuf[b + 9] << 8) | (ifdBuf[b + 10] << 16) | (ifdBuf[b + 11] << 24)
      : (ifdBuf[b + 8] << 24) | (ifdBuf[b + 9] << 16) | (ifdBuf[b + 10] << 8) | ifdBuf[b + 11];

    if (tag === 256) width = count === 1 ? valOrOff : 0; // ImageWidth
    else if (tag === 257) height = count === 1 ? valOrOff : 0; // ImageLength
    else if (tag === 322) tileW = count === 1 ? valOrOff : 0; // TileWidth
    else if (tag === 323) tileH = count === 1 ? valOrOff : 0; // TileHeight
    else if (tag === 324) {
      // TileOffsets — if count==1 offset is inline, else it points to the array
      tileOffsetsOffset = count === 1 ? valOrOff : 0;
      tileOffsetsCount = count;
    }
  }

  if (!width || !height || !tileOffsetsOffset) return null;

  // Read tile offsets array
  const offsetsBuf = Buffer.alloc(tileOffsetsCount * 4);
  await readFile(fd, offsetsBuf, 0, tileOffsetsCount * 4, tileOffsetsOffset);
  const tileOffsets: number[] = [];
  for (let i = 0; i < tileOffsetsCount; i++) {
    tileOffsets.push(
      isLE
        ? offsetsBuf[i * 4] |
          (offsetsBuf[i * 4 + 1] << 8) |
          (offsetsBuf[i * 4 + 2] << 16) |
          (offsetsBuf[i * 4 + 3] << 24)
        : (offsetsBuf[i * 4] << 24) |
          (offsetsBuf[i * 4 + 1] << 16) |
          (offsetsBuf[i * 4 + 2] << 8) |
          offsetsBuf[i * 4 + 3],
    );
  }

  return { width, height, tileOffsets, tileW: tileW || 256, tileH: tileH || 256 };
}

/**
 * LocalTifBackend — reads SRTM elevation directly from local .tif files.
 * No HTTPS, no HuggingFace. OS page cache handles repeated reads efficiently.
 *
 * Implements ChunkBackend.fetchChunk: returns a zlib-compressed delta-encoded
 * 256×256 Int16 chunk compatible with what client-elevation.ts expects.
 */
export class LocalTifBackend {
  constructor(
    private dataDir: string = "/nas/Temp/repos/OpenZenith/data/srtm30m",
  ) {}

  /**
   * Fetch one 256×256 sub-tile chunk from a local SRTM .tif file.
   * Returns empty ArrayBuffer if the tile file is missing or unreadable.
   *
   * The SRTM .tif files use Deflate-compressed tiled storage (256×256 tiles).
   * We decompress the requested tile, then re-encode as zlib so the existing
   * unzlibSync caller in client-elevation.ts can decode it directly.
   */
  async fetchChunk(srtmName: string, chunkRow: number, chunkCol: number): Promise<ArrayBuffer> {
    try {
      const { readFile } = await import("node:fs/promises");
      const { deflateSync, inflateSync } = await import("zlib");

      // Read entire file into memory (~750KB, well within stack limits)
      const buf = await readFile(`${this.dataDir}/${srtmName}`);
      const isLE = buf[0] === 0x49 && buf[1] === 0x49;
      const readU32 = (b: number) =>
        isLE
          ? buf[b] | (buf[b + 1] << 8) | (buf[b + 2] << 16) | (buf[b + 3] << 24)
          : (buf[b] << 24) | (buf[b + 1] << 16) | (buf[b + 2] << 8) | buf[b + 3];

      // Parse IFD (starts at byte 8)
      const numEntries = isLE ? buf[8] | (buf[9] << 8) : (buf[8] << 8) | buf[9];
      const IFD_START = 10; // right after numEntries
      let width = 0,
        height = 0,
        tileOffsetsOffset = 0,
        tileOffsetsCount = 0,
        tileW = 0,
        tileH = 0;

      for (let i = 0; i < numEntries; i++) {
        const b = IFD_START + i * 12;
        const tag = isLE ? buf[b] | (buf[b + 1] << 8) : (buf[b] << 8) | buf[b + 1];
        const type = isLE ? buf[b + 2] | (buf[b + 3] << 8) : (buf[b + 2] << 8) | buf[b + 3];
        const count = readU32(b + 4);
        const val = readU32(b + 8);
        if (tag === 256) width = count === 1 ? val : 0;
        else if (tag === 257) height = count === 1 ? val : 0;
        else if (tag === 322) tileW = count === 1 ? val : 0;
        else if (tag === 323) tileH = count === 1 ? val : 0;
        else if (tag === 324) {
          // type 3=SHORT, type 4=LONG. val is either inline (count=1) or byte offset to array (count>1)
          tileOffsetsOffset = val; // always the pointer/offset regardless of count
          tileOffsetsCount = count;
        }
      }

      if (!width || !height || !tileOffsetsOffset) return new ArrayBuffer(0);

      tileW = tileW || 256;
      tileH = tileH || 256;

      // Read tile offsets array
      const tileOffsets: number[] = [];
      for (let i = 0; i < tileOffsetsCount; i++) {
        tileOffsets.push(readU32(tileOffsetsOffset + i * 4));
      }

      const tilesX = Math.ceil(width / tileW);
      const tileIndex = chunkRow * tilesX + chunkCol;
      if (tileIndex < 0 || tileIndex >= tileOffsets.length) return new ArrayBuffer(0);

      const tileOffset = tileOffsets[tileIndex];
      const nextTileOffset =
        tileIndex + 1 < tileOffsets.length ? tileOffsets[tileIndex + 1] : buf.length;

      // Deflate-decompress this tile (self-terminating stream)
      const compressed = buf.subarray(tileOffset, nextTileOffset);
      const decompressed = inflateSync(compressed);

      // Output dimensions (partial tile at edges: 3601 - 14*256 = 257)
      const tilePixelRows = Math.min(tileH, height - chunkRow * tileH);
      const tilePixelCols = Math.min(tileW, width - chunkCol * tileW);
      const outRows = Math.min(256, tilePixelRows);
      const outCols = Math.min(256, tilePixelCols);

      // Extract pixel window into decoded output
      const decoded = Buffer.alloc(outRows * outCols * 2);
      for (let r = 0; r < outRows; r++) {
        for (let c = 0; c < outCols; c++) {
          const src = (r * tileW + c) * 2;
          const dst = (r * outCols + c) * 2;
          decoded[dst] = decompressed[src];
          decoded[dst + 1] = decompressed[src + 1];
        }
      }

      // Re-zlib encode so client-elevation's unzlibSync() can decode it
      const output = deflateSync(decoded);
      return output.buffer.slice(output.byteOffset, output.byteOffset + output.length);
    } catch {
      return new ArrayBuffer(0);
    }
  }
}

/** Singleton — used by the elevation API routes. */
export const LOCAL_BACKEND = new LocalTifBackend();
