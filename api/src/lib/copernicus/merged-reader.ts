/**
 * Copernicus DEM merged-tile reader.
 *
 * Reads elevation from pre-packaged OZCHNK01 merged files on HuggingFace.
 * Each merged file contains the raw 1024x1024 deflate tiles from a COG,
 * with an index header for efficient range requests.
 *
 * Copernicus GLO-30 merged format (version 2):
 *   [8 bytes]  Magic: "OZCHNK01"
 *   [2 bytes]  Version: 2 (Float32)
 *   [1 byte]   Rows (tiles per column, typically 4)
 *   [1 byte]   Cols (tiles per row, typically 4)
 *   [N*8 bytes] Index: [4-byte offset, 4-byte size] per tile
 *   [variable] Concatenated raw deflate tile data (1024x1024 each)
 *
 * Each tile uses TIFF zlib compression with floating-point predictor (predictor=3).
 * The reader must decompress and undo the predictor to get raw Float32 values.
 */

import { unzlibSync, inflateSync } from "fflate";
import { latLonToTileDir, tileDirToBounds, latLonToPixel } from "./tile-math";

const MERGED_MAGIC = [0x4f, 0x5a, 0x43, 0x48, 0x4e, 0x4b, 0x30, 0x31];
const HEADER_SIZE = 12;
const TILE_DIM = 1024; // Each chunk is 1024x1024

interface MergedIndex {
  version: number;
  rows: number;
  cols: number;
  entries: Array<{ offset: number; size: number }>;
}

/** Cache for merged file indices. */
const mergedIndexCache = new Map<string, { index: MergedIndex; timestamp: number }>();
const MERGED_CACHE_TTL = 5 * 60 * 1000;

/**
 * Convert Copernicus tile directory name to merged file basename.
 * Copernicus_DSM_COG_10_N00_00_E006_00_DEM → COPDEM_N00_00_E006_00
 */
function tileDirToMergedName(tileDir: string): string {
  const m = tileDir.match(/_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM$/);
  if (!m) return tileDir;
  return `COPDEM_${m[1]}${m[2]}_00_${m[3]}${m[4]}_00`;
}

/** Build HuggingFace URL for a merged file. */
function mergedFileUrl(mergedName: string): string {
  return `https://huggingface.co/datasets/aliasfox/copernicus-glo30-chunks/resolve/main/${mergedName}.merged`;
}

/**
 * Decompress zlib/deflate data (same logic as COG reader).
 */
function zlibDecompress(data: Uint8Array): Uint8Array {
  try {
    return unzlibSync(data);
  } catch {
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
 * Same logic as COG reader — decodes byte-differenced, byte-interleaved Float32 data.
 */
function undoFloatPredictor(bytes: Uint8Array, width: number, height: number): void {
  const rowBytes = width * 4;
  const tmp = new Uint8Array(rowBytes);

  for (let r = 0; r < height; r++) {
    const rowStart = r * rowBytes;

    // Undo byte differencing
    for (let i = rowStart + 1; i < rowStart + rowBytes; i++) {
      bytes[i] = (bytes[i] + bytes[i - 1]) & 0xFF;
    }

    // Restore byte order (little-endian transpose)
    for (let i = 0; i < width; i++) {
      tmp[i * 4 + 0] = bytes[rowStart + 3 * width + i]; // LSB
      tmp[i * 4 + 1] = bytes[rowStart + 2 * width + i];
      tmp[i * 4 + 2] = bytes[rowStart + width + i];
      tmp[i * 4 + 3] = bytes[rowStart + i];              // MSB
    }

    bytes.set(tmp, rowStart);
  }
}

/**
 * Fetch and parse the merged file index.
 */
async function fetchMergedIndex(mergedName: string): Promise<MergedIndex | null> {
  const cached = mergedIndexCache.get(mergedName);
  if (cached && Date.now() - cached.timestamp < MERGED_CACHE_TTL) {
    return cached.index;
  }

  // Max index: 16 chunks × 8 bytes = 128. Header = 12. Total = 140.
  const url = mergedFileUrl(mergedName);
  const res = await fetch(url, { headers: { Range: "bytes=0-8191" } });
  if (res.status !== 206 && res.status !== 200) return null;

  const buf = await res.arrayBuffer();
  const data = new Uint8Array(buf);

  if (data.length < HEADER_SIZE) return null;

  for (let i = 0; i < 8; i++) {
    if (data[i] !== MERGED_MAGIC[i]) return null;
  }

  const view = new DataView(buf);
  const version = view.getUint16(8, true);
  if (version !== 2) return null;

  const rows = data[10];
  const cols = data[11];
  const numChunks = rows * cols;

  const entries: Array<{ offset: number; size: number }> = [];
  for (let i = 0; i < numChunks; i++) {
    const off = HEADER_SIZE + i * 8;
    entries.push({
      offset: view.getUint32(off, true),
      size: view.getUint32(off + 4, true),
    });
  }

  const index: MergedIndex = { version, rows, cols, entries };
  mergedIndexCache.set(mergedName, { index, timestamp: Date.now() });
  return index;
}

/**
 * Get elevation from Copernicus merged tiles.
 * Fetches the 1024x1024 tile containing the requested pixel via HTTP range,
 * decompresses, undoes floating-point predictor, and reads the Float32 value.
 */
export async function getCopernicusElevationFromMerged(
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
  const mergedName = tileDirToMergedName(tileDir);

  // Fetch the merged file index
  const index = await fetchMergedIndex(mergedName);
  if (!index) return { ...nullResult, tile: tileDir };

  // Determine which 1024x1024 tile contains the pixel
  const tileRow = Math.floor(row / TILE_DIM);
  const tileCol = Math.floor(col / TILE_DIM);

  if (tileRow >= index.rows || tileCol >= index.cols) {
    return { ...nullResult, tile: tileDir };
  }

  const tileIdx = tileRow * index.cols + tileCol;
  const entry = index.entries[tileIdx];

  // Fetch the compressed tile data via range request
  const url = mergedFileUrl(mergedName);
  const res = await fetch(url, {
    headers: { Range: `bytes=${entry.offset}-${entry.offset + entry.size - 1}` },
  });

  if (res.status !== 206 && res.status !== 200) return { ...nullResult, tile: tileDir };

  const compressed = new Uint8Array(await res.arrayBuffer());

  // Decompress
  const tileData = zlibDecompress(compressed);

  // Undo floating-point predictor (predictor=3)
  // Use full TILE_DIM since TIFF tiles are padded
  undoFloatPredictor(tileData, TILE_DIM, TILE_DIM);

  // Determine actual dimensions (edge tiles may be smaller)
  const actualWidth = Math.min(TILE_DIM, bounds.tileWidth - tileCol * TILE_DIM);
  const actualHeight = Math.min(TILE_DIM, bounds.tileHeight - tileRow * TILE_DIM);

  // Interpret as Float32
  const floatData = new Float32Array(tileData.buffer, tileData.byteOffset, TILE_DIM * TILE_DIM);

  // Local pixel within the tile
  const localRow = row - tileRow * TILE_DIM;
  const localCol = col - tileCol * TILE_DIM;

  if (localRow >= actualHeight || localCol >= actualWidth) {
    return { ...nullResult, tile: tileDir };
  }

  const value = floatData[localRow * TILE_DIM + localCol];

  // Copernicus nodata: -9999 or extreme negative
  if (value === -9999 || value < -9000 || !Number.isFinite(value)) {
    return { ...nullResult, tile: tileDir };
  }

  return {
    elevation: Math.round(value * 10) / 10,
    unit: "meters",
    location: { lat, lon },
    source: "copernicus-glo30-merged",
    tile: tileDir,
    resolution: 30,
  };
}
