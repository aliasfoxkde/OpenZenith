/**
 * Cloud-Optimized GeoTIFF (COG) reader for Copernicus DEM tiles.
 *
 * Reads elevation values directly from S3-hosted COG tiles using
 * HTTP range requests. No pre-chunking needed.
 *
 * Copernicus GLO-30 tiles are:
 * - Float32, 3600x3600 pixels (1 deg x 1 deg)
 * - Tiled: 1024x1024 tiles (4x4 grid = 16 tiles)
 * - Compression: 8 (ZIP/zlib)
 * - Predictor: 3 (floating point horizontal differencing)
 * - No explicit NODATA value (0 = valid data, -9999 = nodata in some tiles)
 */

import { unzlibSync, inflateSync } from "fflate";
import { latLonToTileDir, tileDirToBounds, latLonToPixel, tileDirToUrl } from "./tile-math";

const TILE_DIM = 1024; // Copernicus tiles are 1024x1024
const FLOAT32_SIZE = 4;

interface TiffLayout {
  tileOffsets: number[];
  tileByteCounts: number[];
  compression: number;
  tileWidth: number;
  tileLength: number;
  imageWidth: number;
  imageHeight: number;
  predictor: number;
}

const COMPRESS_NONE = 1;
const COMPRESS_ZIP = 8; // zlib

/**
 * Parse TIFF header + IFD to extract tile layout.
 * Fetches only the first ~2KB of the file.
 */
async function parseTiffLayout(url: string): Promise<TiffLayout | null> {
  const res = await fetch(url, {
    headers: { Range: "bytes=0-2047" },
  });
  if (res.status !== 206 && res.status !== 200) return null;

  const buf = await res.arrayBuffer();
  const data = new Uint8Array(buf);
  const view = new DataView(buf);

  if (data.length < 8) return null;

  // Little-endian TIFF
  if (data[0] !== 0x49 || data[1] !== 0x49) return null;
  if (view.getUint16(2, true) !== 42) return null;

  const ifdOffset = view.getUint32(4, true);
  if (ifdOffset + 2 > data.length) return null;

  const numEntries = view.getUint16(ifdOffset, true);

  let tileOffsets: number[] = [];
  let tileByteCounts: number[] = [];
  let compression = COMPRESS_NONE;
  let tileWidth = 0;
  let tileLength = 0;
  let imageWidth = 0;
  let imageHeight = 0;
  let predictor = 1;

  // First pass: collect inline values and array offsets
  let tileOffsetsOffset = 0;
  let tileByteCountsOffset = 0;
  let tileOffsetsCount = 0;
  let tileByteCountsCount = 0;

  for (let i = 0; i < numEntries; i++) {
    const off = ifdOffset + 2 + i * 12;
    if (off + 12 > data.length) break;

    const tag = view.getUint16(off, true);
    const type = view.getUint16(off + 2, true);
    const count = view.getUint32(off + 4, true);

    if (type === 3 && count <= 2) {
      // SHORT inline
      const v = view.getUint16(off + 8, true);
      if (tag === 256) imageWidth = v;
      if (tag === 257) imageHeight = v;
      if (tag === 258) {
        /* bitsPerSample — always 32 for Copernicus */
      }
      if (tag === 259) compression = v;
      if (tag === 317) predictor = v;
      if (tag === 322) tileWidth = v;
      if (tag === 323) tileLength = v;
    } else if (type === 4 && count === 1) {
      const v = view.getUint32(off + 8, true);
      if (tag === 256) imageWidth = v;
      if (tag === 257) imageHeight = v;
    } else if (type === 4 && count > 1) {
      const arrOffset = view.getUint32(off + 8, true);
      if (tag === 324) {
        tileOffsetsOffset = arrOffset;
        tileOffsetsCount = count;
      }
      if (tag === 325) {
        tileByteCountsOffset = arrOffset;
        tileByteCountsCount = count;
      }
    }
  }

  // Need to fetch tile offset/bytecount arrays if they extend beyond initial read
  const maxNeeded = Math.max(tileOffsetsOffset + tileOffsetsCount * 4, tileByteCountsOffset + tileByteCountsCount * 4);

  if (maxNeeded > data.length && (tileOffsetsOffset > 0 || tileByteCountsOffset > 0)) {
    const res2 = await fetch(url, {
      headers: { Range: `bytes=0-${maxNeeded}` },
    });
    if (res2.status !== 206 && res2.status !== 200) return null;
    const buf2 = await res2.arrayBuffer();
    const data2 = new Uint8Array(buf2);
    const view2 = new DataView(buf2);

    if (tileOffsetsOffset > 0 && tileOffsetsCount > 0) {
      tileOffsets = [];
      for (let i = 0; i < tileOffsetsCount; i++) {
        tileOffsets.push(view2.getUint32(tileOffsetsOffset + i * 4, true));
      }
    }
    if (tileByteCountsOffset > 0 && tileByteCountsCount > 0) {
      tileByteCounts = [];
      for (let i = 0; i < tileByteCountsCount; i++) {
        tileByteCounts.push(view2.getUint32(tileByteCountsOffset + i * 4, true));
      }
    }
  } else if (tileOffsetsOffset > 0) {
    // Data already in buffer
    const view2 = new DataView(data.buffer, data.byteOffset, data.length);
    if (tileOffsetsCount > 0) {
      tileOffsets = [];
      for (let i = 0; i < tileOffsetsCount; i++) {
        tileOffsets.push(view2.getUint32(tileOffsetsOffset + i * 4, true));
      }
    }
    if (tileByteCountsCount > 0) {
      tileByteCounts = [];
      for (let i = 0; i < tileByteCountsCount; i++) {
        tileByteCounts.push(view2.getUint32(tileByteCountsOffset + i * 4, true));
      }
    }
  }

  if (tileOffsets.length === 0 || tileByteCounts.length === 0) return null;
  if (imageWidth === 0 || imageHeight === 0) return null;
  if (tileWidth === 0) tileWidth = imageWidth;
  if (tileLength === 0) tileLength = imageHeight;

  return { tileOffsets, tileByteCounts, compression, tileWidth, tileLength, imageWidth, imageHeight, predictor };
}

/**
 * Decompress zlib/deflate data using fflate (edge-compatible).
 * TIFF compression=8 may be zlib-wrapped or raw deflate.
 */
function zlibDecompress(data: Uint8Array): Uint8Array {
  // Try zlib-wrapped first (handles header + Adler32)
  try {
    return unzlibSync(data);
  } catch {
    // Fall back to raw deflate (strip potential 2-byte zlib header)
    try {
      const raw = data[0] === 0x78 ? data.slice(2) : data;
      return inflateSync(raw);
    } catch {
      return data;
    }
  }
}

/**
 * Undo TIFF floating-point predictor (predictor=3).
 * Implements TIFF Technical Note 3 (same as imagecodecs.floatpred_decode).
 *
 * The encoded data has bytes reordered so byte N of all values is contiguous
 * (MSB group first for little-endian), with byte-level horizontal differencing
 * applied across the entire row.
 *
 * Decode steps (per row):
 * 1. Undo byte differencing via cumulative sum
 * 2. Restore byte order by transposing groups back to per-float layout
 */
function undoFloatPredictor(bytes: Uint8Array, width: number, height: number): void {
  const rowBytes = width * 4; // Float32 = 4 bytes per pixel
  const tmp = new Uint8Array(rowBytes);

  for (let r = 0; r < height; r++) {
    const rowStart = r * rowBytes;

    // Step 1: Undo byte differencing (cumulative sum) on the row
    // Encoded layout: [MSB_all | byte2_all | byte1_all | LSB_all]
    // Each group has `width` bytes; differencing was applied across all rowBytes
    for (let i = rowStart + 1; i < rowStart + rowBytes; i++) {
      bytes[i] = (bytes[i] + bytes[i - 1]) & 0xff;
    }

    // Step 2: Restore byte order (transpose back to per-float layout)
    // Little-endian: dst[4*i + j] = src[(3-j)*width + i]
    for (let i = 0; i < width; i++) {
      tmp[i * 4 + 0] = bytes[rowStart + 3 * width + i]; // LSB
      tmp[i * 4 + 1] = bytes[rowStart + 2 * width + i]; // byte 1
      tmp[i * 4 + 2] = bytes[rowStart + width + i]; // byte 2
      tmp[i * 4 + 3] = bytes[rowStart + i]; // MSB
    }

    bytes.set(tmp, rowStart);
  }
}

/**
 * Look up elevation from a Copernicus DEM COG tile via HTTP range requests.
 */
export async function getCopernicusElevation(
  lat: number,
  lon: number,
): Promise<{
  elevation: number | null;
  unit: string;
  location: { lat: number; lon: number };
  source: string;
  tile: string;
  resolution: number;
}> {
  const nullResult = {
    elevation: null as number | null,
    unit: "meters",
    location: { lat, lon },
    source: "copernicus-glo30" as string,
    tile: "" as string,
    resolution: 30,
  };

  const tileDir = latLonToTileDir(lat, lon);
  const bounds = tileDirToBounds(tileDir);
  if (!bounds) return { ...nullResult, tile: tileDir };

  const { row, col } = latLonToPixel(lat, lon, bounds);
  const url = tileDirToUrl(tileDir);

  // Parse TIFF layout
  const layout = await parseTiffLayout(url);
  if (!layout) return { ...nullResult, tile: tileDir };

  // Determine which 1024x1024 tile contains the target pixel
  const tilesPerRow = Math.ceil(layout.imageWidth / layout.tileWidth);
  const tileCol = Math.floor(col / layout.tileWidth);
  const tileRow = Math.floor(row / layout.tileLength);
  const tileIndex = tileRow * tilesPerRow + tileCol;

  if (tileIndex >= layout.tileOffsets.length) return { ...nullResult, tile: tileDir };

  const tileOffset = layout.tileOffsets[tileIndex];
  const tileByteCount = layout.tileByteCounts[tileIndex];

  // Fetch the tile data via range request
  const res = await fetch(url, {
    headers: { Range: `bytes=${tileOffset}-${tileOffset + tileByteCount - 1}` },
  });
  if (res.status !== 206 && res.status !== 200) return { ...nullResult, tile: tileDir };

  const compressed = new Uint8Array(await res.arrayBuffer());

  // Decompress
  let tileData: Uint8Array;
  if (layout.compression === COMPRESS_ZIP) {
    tileData = zlibDecompress(compressed);
  } else {
    tileData = compressed;
  }

  // Determine actual tile dimensions (edge tiles may be smaller)
  const actualWidth = Math.min(layout.tileWidth, layout.imageWidth - tileCol * layout.tileWidth);
  const actualHeight = Math.min(layout.tileLength, layout.imageHeight - tileRow * layout.tileLength);

  // Undo floating point predictor on raw bytes BEFORE Float32 interpretation.
  // Use full tile dimensions (not actual) since TIFF tiles are always padded to
  // their full TileWidth x TileLength size, and the predictor was applied to
  // the full tile rows.
  if (layout.predictor === 3) {
    undoFloatPredictor(tileData, layout.tileWidth, layout.tileLength);
  }

  // Interpret as Float32 (full tile dimensions)
  const floatData = new Float32Array(tileData.buffer, tileData.byteOffset, layout.tileWidth * layout.tileLength);

  // Get pixel value
  const localCol = col - tileCol * layout.tileWidth;
  const localRow = row - tileRow * layout.tileLength;

  if (localRow >= actualHeight || localCol >= actualWidth) return { ...nullResult, tile: tileDir };

  const value = floatData[localRow * layout.tileWidth + localCol];

  // Copernicus nodata: -9999 or extreme negative
  if (value === -9999 || value < -9000 || !Number.isFinite(value)) {
    return { ...nullResult, tile: tileDir };
  }

  return {
    elevation: Math.round(value * 10) / 10,
    unit: "meters",
    location: { lat, lon },
    source: "copernicus-glo30",
    tile: tileDir,
    resolution: 30,
  };
}
