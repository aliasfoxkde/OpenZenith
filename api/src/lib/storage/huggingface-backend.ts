/**
 * HuggingFace chunk backend — edge-compatible, no Node.js imports.
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

// --- Implementation ---

abstract class BaseChunkBackend implements ChunkBackend {
  constructor(protected tryMerged: boolean) {}

  abstract buildUrl(path: string): string;

  protected async fetchMergedFile(srtmName: string): Promise<{ data: Uint8Array; index: MergedIndex } | null> {
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
