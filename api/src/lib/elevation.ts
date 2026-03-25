/**
 * Core elevation lookup logic.
 *
 * Given a lat/lon, determines which SRTM tile contains it,
 * fetches the pre-extracted 256x256 chunk, decompresses it,
 * and returns the elevation value.
 */

import { decompressSync } from "fflate";
import {
  latLonToSrtmName,
  srtmNameToBounds,
  latLonToPixel,
  isWithinSRTM,
} from "./srtm/tile-math";
import type { ChunkBackend } from "./storage/backend";
import { cacheGet, cachePut } from "./storage/cache";

export interface ElevationResult {
  elevation: number | null;
  unit: string;
  location: { lat: number; lon: number };
  source: string;
  srtmTile: string;
  resolution: number;
}

const NODATA = -32768;

/**
 * Look up the elevation at a given lat/lon.
 *
 * Flow:
 * 1. Compute SRTM tile filename from lat/lon
 * 2. Compute pixel position → chunk row/col
 * 3. Fetch pre-extracted chunk (cached)
 * 4. Decompress and extract pixel value
 */
export async function getElevation(
  lat: number,
  lon: number,
  storage: ChunkBackend,
): Promise<ElevationResult> {
  if (!isWithinSRTM(lat, lon)) {
    return {
      elevation: null,
      unit: "meters",
      location: { lat, lon },
      source: "none",
      srtmTile: "none",
      resolution: 0,
    };
  }

  const srtmName = latLonToSrtmName(lat, lon);
  const bounds = srtmNameToBounds(srtmName);

  // Compute pixel position and chunk grid coordinates
  const { row, col } = latLonToPixel(lat, lon, bounds);
  const chunkRow = Math.floor(row / 256);
  const chunkCol = Math.floor(col / 256);
  const localRow = row % 256;
  const localCol = col % 256;

  // Fetch chunk
  const chunkKey = `oz:chunk:${srtmName}:${chunkRow}:${chunkCol}`;
  let compressedData = await cacheGet(chunkKey);
  if (!compressedData) {
    try {
      compressedData = await storage.fetchChunk(srtmName, chunkRow, chunkCol);
      await cachePut(chunkKey, compressedData);
    } catch {
      // Chunk not available (not uploaded yet or no data for this area)
      return {
        elevation: null,
        unit: "meters",
        location: { lat, lon },
        source: "none",
        srtmTile: srtmName,
        resolution: 0,
      };
    }
  }

  // Decompress
  const rawBytes = decompressSync(new Uint8Array(compressedData));

  // Compute chunk dimensions (edge tiles may be smaller than 256x256)
  const tilesAcross = 15;
  const tilesDown = 15;
  const chunkWidth =
    chunkCol < tilesAcross - 1 ? 256 : 3601 - (tilesAcross - 1) * 256;
  const chunkHeight =
    chunkRow < tilesDown - 1 ? 256 : 3601 - (tilesDown - 1) * 256;

  // Interpret as Int16
  const pixels = chunkWidth * chunkHeight;
  const rawData = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, pixels);

  // Undo TIFF horizontal predictor (predictor=2).
  // The SRTM GeoTIFF tiles are stored with horizontal differencing:
  // each sample is the difference from the previous sample in the row.
  // Undo by cumulative sum per row.
  const data = new Int16Array(pixels);
  for (let r = 0; r < chunkHeight; r++) {
    const rowOff = r * chunkWidth;
    data[rowOff] = rawData[rowOff]; // first pixel is the absolute value
    for (let c = 1; c < chunkWidth; c++) {
      data[rowOff + c] = data[rowOff + c - 1] + rawData[rowOff + c];
    }
  }

  // Extract elevation with bilinear interpolation
  const getPixel = (r: number, c: number): number => {
    if (r < 0 || r >= chunkHeight || c < 0 || c >= chunkWidth) return NODATA;
    return data[r * chunkWidth + c];
  };

  // Nearest-neighbor: just use the exact pixel
  const nearest = getPixel(localRow, localCol);

  // Bilinear interpolation using 4 surrounding pixels
  // Compute fractional pixel position for interpolation
  const exactRow = (bounds.latMax - lat) * 3600;
  const exactCol = (lon - bounds.lonMin) * 3600;
  const chunkStartRow = chunkRow * 256;
  const chunkStartCol = chunkCol * 256;
  const fracRow = exactRow - chunkStartRow;
  const fracCol = exactCol - chunkStartCol;

  const r0 = Math.floor(fracRow);
  const c0 = Math.floor(fracCol);
  const r1 = r0 + 1;
  const c1 = c0 + 1;
  const fy = fracRow - r0;
  const fx = fracCol - c0;

  const v00 = getPixel(r0, c0);
  const v10 = getPixel(r1, c0);
  const v01 = getPixel(r0, c1);
  const v11 = getPixel(r1, c1);

  // If any corner is nodata, fall back to nearest-neighbor
  const hasNodata = v00 === NODATA || v10 === NODATA || v01 === NODATA || v11 === NODATA;

  const elevation = hasNodata
    ? (nearest === NODATA ? null : nearest)
    : Math.round(
        v00 * (1 - fx) * (1 - fy) +
        v01 * fx * (1 - fy) +
        v10 * (1 - fx) * fy +
        v11 * fx * fy,
      );

  return {
    elevation: elevation === NODATA ? null : elevation,
    unit: "meters",
    location: { lat, lon },
    source: "srtm30m",
    srtmTile: srtmName,
    resolution: 30,
  };
}
