/**
 * OZT2 HuggingFace backend — edge-compatible, no Node.js imports.
 *
 * Fetches OZT2 tiles from HuggingFace datasets (aliasfox/srtm30m-ozt2-v2),
 * decodes them using the pure-TypeScript OZT2 decoder.
 *
 * Falls back to HuggingFaceChunkBackend (merged chunks) for:
 * - Tiles not yet in the OZT2 dataset
 * - Fetch/decode errors
 */

import { decodeOZT2 } from "@/lib/ozt2_decode";
import { latLonToTile, tileToLatLon } from "@/lib/srtm/zoom-math";
import { HuggingFaceChunkBackend } from "./huggingface-backend";
import { cacheGet, cachePut } from "./cache";
import { unzlibSync } from "fflate";

export interface OZT2BackendOptions {
  /** HuggingFace dataset repo ID for OZT2 tiles */
  repoId?: string;
  /** Zoom level for tile lookups (z7–z11 recommended) */
  zoom?: number;
  /** HuggingFace repo ID for fallback merged chunks */
  fallbackRepoId?: string;
  /** Seconds before timing out a fetch */
  timeoutSecs?: number;
}

/**
 * OZT2 tile backend with merged-chunk fallback.
 *
 * Strategy:
 * 1. Convert lat/lon → Mercator tile (z/zoom)
 * 2. Fetch OZT2 tile from HuggingFace
 * 3. Decode OZT2 → Int16Array (256×256)
 * 4. Bilinearly sample the pixel at the query point
 * 5. Fall back to merged chunks if OZT2 fetch fails
 */
export class OZT2HuggingFaceBackend {
  private readonly repoId: string;
  private readonly zoom: number;
  private readonly timeoutMs: number;
  private readonly fallback: HuggingFaceChunkBackend;

  // In-memory cache for decoded tiles (avoids re-decompressing frequently-used tiles)
  private readonly tileCache = new Map<string, { data: Int16Array; timestamp: number }>();
  private static readonly TILE_CACHE_TTL = 30 * 60 * 1000; // 30 min

  constructor(options: OZT2BackendOptions = {}) {
    this.repoId = options.repoId ?? "aliasfox/srtm30m-ozt2-v2";
    this.zoom = options.zoom ?? 10; // z10 ≈ 19m/pixel (Nyquist-optimal from SRTM 30m)
    this.timeoutMs = (options.timeoutSecs ?? 8) * 1000;
    this.fallback = new HuggingFaceChunkBackend(
      options.fallbackRepoId ?? "aliasfox/srtm30m-merged",
      true,
    );
  }

  /**
   * Fetch a 256×256 OZT2 tile from HuggingFace and decode it.
   * Returns null on any error (caller should fall back).
   */
  private async fetchAndDecodeTile(z: number, x: number, y: number): Promise<Int16Array | null> {
    const cacheKey = `oz:ozt2:${z}:${x}:${y}`;
    const memCached = _getCachedTile(cacheKey);
    if (memCached) {
      return memCached.data;
    }

    // Try CF cache first
    try {
      const cached = await cacheGet(cacheKey);
      if (cached) {
        const data = new Int16Array(cached);
        _setCachedTile(cacheKey, data);
        return data;
      }
    } catch {
      // CF cache unavailable — proceed with fetch
    }

    const url = `https://huggingface.co/datasets/${this.repoId}/resolve/main/tiles/z${z}/${x}/${y}.ozt2`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return null;

      const buffer = await response.arrayBuffer();
      const result = await decodeOZT2(buffer);
      const data = result.elevation;

      // Cache decoded tile in memory
      _setCachedTile(cacheKey, data);
      // Store compressed form in CF cache for cross-isolate use
      cachePut(cacheKey, buffer).catch(() => {});

      return data;
    } catch {
      clearTimeout(timer);
      return null;
    }
  }

  /**
   * Fetch and decode a full 256×256 OZT2 tile.
   * Returns null if the tile is not available (not yet generated or fetch error).
   *
   * Uses the backend's zoom level. For best results use the same zoom
   * the tile was generated at (z10 recommended).
   */
  async getTile(z: number, x: number, y: number): Promise<Int16Array | null> {
    return this.fetchAndDecodeTile(z, x, y);
  }

  /**
   * Get elevation at a single lat/lon point.
   * Returns null if the point has no data in any source.
   */
  async getElevation(lat: number, lon: number): Promise<number | null> {
    // Try OZT2 first
    const { x, y } = latLonToTile(lat, lon, this.zoom);
    const tile = await this.fetchAndDecodeTile(this.zoom, x, y);

    if (tile) {
      const elevation = this.sampleTile(tile, lat, lon);
      if (elevation !== null && elevation !== -32768) {
        return elevation;
      }
    }

    // Fall back to merged chunks (HuggingFaceChunkBackend)
    try {
      const srtmName = this.latLonToSrtmName(lat, lon);
      const srtmBounds = this.srtmNameToBounds(srtmName);
      const pixel = this.latLonToPixel(lat, lon, srtmBounds);
      const chunkRow = Math.floor(pixel.row / 256);
      const chunkCol = Math.floor(pixel.col / 256);

      const chunkCacheKey = `oz:chunk:${srtmName}:${chunkRow}:${chunkCol}`;
      let compressedData = await cacheGet(chunkCacheKey);
      if (!compressedData) {
        compressedData = await this.fallback.fetchChunk(srtmName, chunkRow, chunkCol);
        if (compressedData) {
          await cachePut(chunkCacheKey, compressedData).catch(() => {});
        }
      }

      if (compressedData) {
        const rawBytes = unzlibSync(new Uint8Array(compressedData));
        const chunkWidth = chunkCol < 14 ? 256 : 3601 - 14 * 256;
        const chunkHeight = chunkRow < 14 ? 256 : 3601 - 14 * 256;
        const pixels = chunkWidth * chunkHeight;
        const rawData = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, pixels);
        const data = new Int16Array(pixels);
        data[0] = rawData[0];
        for (let r = 0; r < chunkHeight; r++) {
          const rowOff = r * chunkWidth;
          data[rowOff] = rawData[rowOff];
          for (let c = 1; c < chunkWidth; c++) {
            data[rowOff + c] = data[rowOff + c - 1] + rawData[rowOff + c];
          }
        }
        const localRow = pixel.row - chunkRow * 256;
        const localCol = pixel.col - chunkCol * 256;
        if (localRow >= 0 && localRow < chunkHeight && localCol >= 0 && localCol < chunkWidth) {
          const elev = data[localRow * chunkWidth + localCol];
          if (elev !== -32768) return elev;
        }
      }
    } catch {
      // Fall through to null
    }

    return null;
  }

  // ─── Coordinate utilities (mirrors srtm/tile-math.ts) ───────────────────────

  private latLonToSrtmName(lat: number, lon: number): string {
    const latDir = lat >= 0 ? "N" : "S";
    const lonDir = lon >= 0 ? "E" : "W";
    const latDeg = Math.floor(Math.abs(lat));
    const lonDeg = Math.floor(Math.abs(lon));
    return `${latDir}${String(latDeg).padStart(2, "0")}${lonDir}${String(lonDeg).padStart(3, "0")}.tif`;
  }

  private srtmNameToBounds(name: string): { latMin: number; lonMin: number; latMax: number; lonMax: number } {
    const latDir = name[0];
    const latDeg = parseInt(name.substring(1, 3));
    const lonDir = name[3];
    const lonDeg = parseInt(name.substring(4, 7));
    return {
      latMin: latDir === "N" ? latDeg : -(latDeg + 1),
      latMax: latDir === "N" ? latDeg + 1 : -latDeg,
      lonMin: lonDir === "E" ? lonDeg : -(lonDeg + 1),
      lonMax: lonDir === "E" ? lonDeg + 1 : -lonDeg,
    };
  }

  private latLonToPixel(
    lat: number,
    lon: number,
    bounds: { latMin: number; lonMin: number; latMax: number; lonMax: number },
  ): { row: number; col: number } {
    const row = Math.round((bounds.latMax - lat) * 3600);
    const col = Math.round((lon - bounds.lonMin) * 3600);
    return { row, col };
  }

  /**
   * Bilinearly sample a 256×256 decoded OZT2 tile at the given lat/lon.
   * Returns null if the sample is NODATA.
   */
  private sampleTile(tile: Int16Array, lat: number, lon: number): number | null {
    // Get tile's geographic bounds at the backend's zoom level
    const { north, south, east, west } = tileToLatLon(this.zoom, latLonToTile(lat, lon, this.zoom).x, latLonToTile(lat, lon, this.zoom).y);

    // Normalize lat/lon into tile pixel space [0, 256)
    const xFrac = Math.max(0, Math.min(255.999, ((lon - west) / (east - west)) * 256));
    const yFrac = Math.max(0, Math.min(255.999, ((north - lat) / (north - south)) * 256));

    const x0 = Math.floor(xFrac);
    const y0 = Math.floor(yFrac);
    const x1 = Math.min(255, x0 + 1);
    const y1 = Math.min(255, y0 + 1);

    const ix = xFrac - x0;
    const iy = yFrac - y0;

    const get = (x: number, y: number): number => tile[y * 256 + x];

    const v00 = get(x0, y0);
    const v10 = get(x1, y0);
    const v01 = get(x0, y1);
    const v11 = get(x1, y1);

    const nodata = -32768;
    const allNodata = [v00, v10, v01, v11].every(v => v === nodata);
    if (allNodata) return null;

    // Bilinear interpolation (treat nodata as 0 but only when blending)
    const w00 = (1 - ix) * (1 - iy);
    const w10 = ix * (1 - iy);
    const w01 = (1 - ix) * iy;
    const w11 = ix * iy;

    // If any corner is nodata, weight by valid neighbors
    const corners = [
      { v: v00, w: w00 },
      { v: v10, w: w10 },
      { v: v01, w: w01 },
      { v: v11, w: w11 },
    ];
    const valid = corners.filter(c => c.v !== nodata);
    if (valid.length === 0) return null;
    if (valid.length === 4) {
      return Math.round(valid.reduce((s, c) => s + c.v * c.w, 0));
    }
    // Partial nodata: renormalize weights over valid corners only
    const totalW = valid.reduce((s, c) => s + c.w, 0);
    return Math.round(valid.reduce((s, c) => s + c.v * c.w, 0) / totalW);
  }
}

// ─── Module-level tile cache (shared across all instances) ────────────────────

const _tileCache = new Map<string, { data: Int16Array; timestamp: number }>();
const _tileCacheTtl = 30 * 60 * 1000; // 30 min

function _getCachedTile(key: string): { data: Int16Array; timestamp: number } | null {
  const entry = _tileCache.get(key);
  if (entry && Date.now() - entry.timestamp < _tileCacheTtl) return entry;
  return null;
}

function _setCachedTile(key: string, data: Int16Array): void {
  _tileCache.set(key, { data, timestamp: Date.now() });
}
