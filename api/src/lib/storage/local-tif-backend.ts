/**
 * Local SRTM .tif file backend — Node.js only, not edge-compatible.
 * This module uses node:fs and must not be imported by edge routes.
 */

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

/** Singleton — used by the elevation API routes (Node.js runtime only). */
export const LOCAL_BACKEND = new LocalTifBackend();
