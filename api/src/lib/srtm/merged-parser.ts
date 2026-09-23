/**
 * Merged SRTM file parser — browser and server compatible.
 *
 * Parses the OZCHNK01 binary format used by HuggingFace SRTM merged files.
 * No Node.js dependencies — pure JS using Uint8Array/DataView plus fflate
 * for chunk inflation.
 *
 * Binary layout:
 *   [8 bytes]  Magic: "OZCHNK01"
 *   [2 bytes]  Version: 1 (SRTM Int16) or 2 (Copernicus Float32)
 *   [1 byte]   Rows (chunks per tile row)
 *   [1 byte]   Cols (chunks per tile col)
 *   [N * 8 bytes] Index: [4-byte offset LE, 4-byte size LE] per chunk
 *   [variable] Concatenated deflate-compressed chunk data
 */

import { unzlibSync } from "fflate";

export interface MergedIndex {
  rows: number;
  cols: number;
  entries: Array<{ offset: number; size: number }>;
}

const MERGED_MAGIC = new Uint8Array([0x4f, 0x5a, 0x43, 0x48, 0x4e, 0x4b, 0x30, 0x31]); // "OZCHNK01"
const HEADER_SIZE = 12;
const INDEX_ENTRY_SIZE = 8;

export function parseMergedHeader(data: Uint8Array): MergedIndex | null {
  if (data.length < HEADER_SIZE) return null;

  for (let i = 0; i < 8; i++) {
    if (data[i] !== MERGED_MAGIC[i]) return null;
  }

  const view = new DataView(data.buffer, data.byteOffset);
  const version = view.getUint16(8, true);
  if (version !== 1 && version !== 2) return null;

  const rows = data[10];
  const cols = data[11];

  // The index must actually be present — a truncated header would otherwise
  // raise RangeError from the DataView reads below.
  if (data.length < HEADER_SIZE + rows * cols * INDEX_ENTRY_SIZE) return null;

  const entries: Array<{ offset: number; size: number }> = [];
  for (let i = 0; i < rows * cols; i++) {
    const off = HEADER_SIZE + i * INDEX_ENTRY_SIZE;
    entries.push({
      offset: view.getUint32(off, true),
      size: view.getUint32(off + 4, true),
    });
  }

  return { rows, cols, entries };
}

/** Indexed lookup that stays nullable — an out-of-range chunk has no entry. */
function entryAt(entries: MergedIndex["entries"], idx: number): MergedIndex["entries"][number] | undefined {
  return entries[idx];
}

export function extractChunkFromMerged(
  mergedData: Uint8Array,
  index: MergedIndex,
  row: number,
  col: number,
): Uint8Array {
  const idx = row * index.cols + col;
  const entry = entryAt(index.entries, idx);
  // A corrupt index (out-of-range chunk or chunk extending past EOF) must
  // throw a catchable error, not slice garbage or RangeError deep in DataView.
  if (!entry || entry.offset + entry.size > mergedData.length) {
    throw new RangeError(`Merged chunk ${row}/${col} out of bounds`);
  }
  return mergedData.slice(entry.offset, entry.offset + entry.size);
}

/** SRTM tile name helpers — shared between server and client. */
export function getLatDir(srtmName: string): string {
  return srtmName.substring(0, 3);
}

export function getTileBase(srtmName: string): string {
  return srtmName.replace(".tif", "");
}

// --- Chunk decoding (shared by every .merged consumer) ---

// A 1° SRTM cell is 3601x3601 samples in a 15x15 chunk grid. Chunks are
// always STORED 256x256 — the last row/column pad to the full square, so
// the real (sampling) extent of an edge chunk is 3601 - 14*256 = 17 pixels.
// Verified against openzenith/merged.py, which reshapes every chunk to
// (256, 256) regardless of position.
export const MERGED_CHUNKS_PER_AXIS = 15;
export const MERGED_CHUNK_STRIDE = 256;
export const MERGED_EDGE_EXTENT = 3601 - 14 * MERGED_CHUNK_STRIDE;

/** The real (non-padding) pixel extent of a chunk within the 15x15 grid. */
export function chunkRealExtent(chunkRow: number, chunkCol: number): { width: number; height: number } {
  return {
    width: chunkCol < MERGED_CHUNKS_PER_AXIS - 1 ? MERGED_CHUNK_STRIDE : MERGED_EDGE_EXTENT,
    height: chunkRow < MERGED_CHUNKS_PER_AXIS - 1 ? MERGED_CHUNK_STRIDE : MERGED_EDGE_EXTENT,
  };
}

export interface DecodedMergedChunk {
  data: Int16Array;
  width: number;
  height: number;
}

/**
 * Decompress one stored chunk and undo its TIFF horizontal predictor
 * (predictor=2: each pixel stores the difference to its left neighbour).
 *
 * The cumulative sum MUST run at the stored 256-pixel stride. Decoding at
 * the 17-pixel edge extent misaligns every row after the first and turns
 * the chunk into garbage — a production defect that painted constant
 * -6385m stripes across tiles overlapping any SRTM cell's last 17 columns.
 *
 * Returns the real-extent pixel window (padding cropped), or null when the
 * bytes are not a decodable chunk.
 */
export function decodeMergedChunk(rawChunk: Uint8Array, chunkRow: number, chunkCol: number): DecodedMergedChunk | null {
  let rawBytes: Uint8Array;
  try {
    rawBytes = unzlibSync(rawChunk);
  } catch {
    return null;
  }

  const stride = MERGED_CHUNK_STRIDE;
  // A chunk shorter than the stored square is truncated, not merely padded.
  if (rawBytes.length < stride * stride * 2) return null;

  const rawData = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, stride * stride);
  const { width, height } = chunkRealExtent(chunkRow, chunkCol);
  const data = new Int16Array(width * height);
  for (let r = 0; r < height; r++) {
    const srcRow = r * stride;
    const dstRow = r * width;
    data[dstRow] = rawData[srcRow]; // first pixel is the absolute value
    for (let c = 1; c < width; c++) {
      data[dstRow + c] = data[dstRow + c - 1] + rawData[srcRow + c];
    }
  }
  return { data, width, height };
}
