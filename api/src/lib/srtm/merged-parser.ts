/**
 * Merged SRTM file parser — browser and server compatible.
 *
 * Parses the OZCHNK01 binary format used by HuggingFace SRTM merged files.
 * No Node.js dependencies — pure JS using Uint8Array/DataView.
 *
 * Binary layout:
 *   [8 bytes]  Magic: "OZCHNK01"
 *   [2 bytes]  Version: 1 (SRTM Int16) or 2 (Copernicus Float32)
 *   [1 byte]   Rows (chunks per tile row)
 *   [1 byte]   Cols (chunks per tile col)
 *   [N * 8 bytes] Index: [4-byte offset LE, 4-byte size LE] per chunk
 *   [variable] Concatenated deflate-compressed chunk data
 */

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

export function extractChunkFromMerged(
  mergedData: Uint8Array,
  index: MergedIndex,
  row: number,
  col: number,
): Uint8Array {
  const idx = row * index.cols + col;
  const entry = index.entries[idx];
  return mergedData.slice(entry.offset, entry.offset + entry.size);
}

/** SRTM tile name helpers — shared between server and client. */
export function getLatDir(srtmName: string): string {
  return srtmName.substring(0, 3);
}

export function getTileBase(srtmName: string): string {
  return srtmName.replace(".tif", "");
}
