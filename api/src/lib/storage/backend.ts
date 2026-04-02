/**
 * Chunk-based storage backend for pre-extracted DEM tiles.
 *
 * Supports two file formats:
 * 1. Individual .deflate chunks (one 256x256 chunk per file)
 * 2. Merged .merged files (all chunks for one tile in one file)
 *
 * The merged format uses a simple binary layout:
 *   [8 bytes] Magic: "OZCHNK01"
 *   [2 bytes] Version: 1 (SRTM Int16) or 2 (Copernicus Float32)
 *   [1 byte]  Rows (chunks per tile row)
 *   [1 byte]  Cols (chunks per tile col)
 *   [N * 8 bytes] Index: [4-byte offset LE, 4-byte size LE] per chunk
 *   [variable] Concatenated deflate-compressed chunk data
 *
 * Version 1 (SRTM): 15x15 grid, Int16, 3601x3601 tiles
 * Version 2 (Copernicus): variable grid, Float32, 3600x3600 tiles
 *
 * URL patterns:
 *   Individual: {base}/{base}_{row:02d}_{col:02d}.deflate
 *   Merged:     {base}/{base}.merged
 */

export type BackendType = "huggingface" | "http";

export interface ChunkBackend {
  /** Fetch a single 256x256 chunk by SRTM tile name and grid position. */
  fetchChunk(srtmName: string, row: number, col: number): Promise<ArrayBuffer>;
}

export function createChunkBackend(
  type: BackendType,
  config: Record<string, string>,
): ChunkBackend {
  switch (type) {
    case "huggingface":
      return new HuggingFaceChunkBackend(
        config.repo || "aliasfox/srtm30m-chunks",
        config.useMerged !== "false", // default: try merged first
      );
    case "http":
      return new HttpChunkBackend(
        config.baseUrl || "",
        config.useMerged !== "false",
      );
    default:
      throw new Error(`Unknown backend type: ${type}`);
  }
}

export function getDefaultBackend(): ChunkBackend {
  const type = (process.env.STORAGE_BACKEND || "huggingface") as BackendType;
  return createChunkBackend(type, {
    repo: process.env.HF_REPO || "aliasfox/srtm30m-chunks",
    baseUrl: process.env.TILES_BASE_URL || "",
    useMerged: process.env.USE_MERGED || "true",
  });
}

// --- Merged file parsing ---

const MERGED_MAGIC = new Uint8Array([0x4f, 0x5a, 0x43, 0x48, 0x4e, 0x4b, 0x30, 0x31]); // "OZCHNK01"
const HEADER_SIZE = 12; // 8 magic + 2 version + 1 rows + 1 cols
const INDEX_ENTRY_SIZE = 8; // 4-byte offset + 4-byte size

interface MergedIndex {
  rows: number;
  cols: number;
  entries: Array<{ offset: number; size: number }>;
}

function parseMergedHeader(data: Uint8Array): MergedIndex | null {
  if (data.length < HEADER_SIZE) return null;

  // Check magic
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

function extractChunkFromMerged(
  mergedData: Uint8Array,
  index: MergedIndex,
  row: number,
  col: number,
): Uint8Array {
  const idx = row * index.cols + col;
  const entry = index.entries[idx];
  return mergedData.slice(entry.offset, entry.offset + entry.size);
}

// --- Helper to build paths ---

function getLatDir(srtmName: string): string {
  return srtmName.substring(0, 3);
}

function getTileBase(srtmName: string): string {
  return srtmName.replace(".tif", "");
}

// --- Cache for merged files ---

const mergedFileCache = new Map<string, { data: Uint8Array; index: MergedIndex; timestamp: number }>();
const MERGED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// --- Implementations ---

abstract class BaseChunkBackend implements ChunkBackend {
  constructor(protected tryMerged: boolean) {}

  abstract buildUrl(path: string): string;

  private async fetchMergedFile(srtmName: string): Promise<{ data: Uint8Array; index: MergedIndex } | null> {
    const cacheKey = srtmName;
    const cached = mergedFileCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < MERGED_CACHE_TTL) {
      return { data: cached.data, index: cached.index };
    }

    const latDir = getLatDir(srtmName);
    const base = getTileBase(srtmName);
    const url = this.buildUrl(`${latDir}/${base}.merged`);

    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);
    const index = parseMergedHeader(data);
    if (!index) return null;

    mergedFileCache.set(cacheKey, { data, index, timestamp: Date.now() });
    return { data, index };
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

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Chunk not found: ${srtmName} row=${row} col=${col} (${response.status})`,
      );
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

class HttpChunkBackend extends BaseChunkBackend {
  constructor(
    private baseUrl: string,
    tryMerged: boolean,
  ) {
    super(tryMerged);
  }

  buildUrl(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}/${path}`;
  }
}
