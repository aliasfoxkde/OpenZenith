/**
 * Lightweight point elevation lookup.
 *
 * Unlike getTileData() which assembles a full 256x256 grid, this only fetches
 * and decompresses the single 256x256 chunk containing the query point.
 * Dramatically reduces CPU time vs full tile assembly (~0.5ms vs ~5ms).
 */

import { unzlibSync } from "fflate";
import { latLonToSrtmName, srtmNameToBounds, latLonToPixel, isWithinSRTM } from "./srtm/tile-math";
import type { ChunkBackend } from "./storage/backend";
import { cacheGet, cachePut } from "./storage/cache";

const NODATA = -32768;

export interface PointElevationResult {
  elevation: number;
  surfaceType: "land" | "ocean";
  tile: string;
}

/**
 * Get elevation at a single lat/lon point.
 * Only fetches and decompresses the one 256x256 chunk needed.
 */
export async function getPointElevation(
  lat: number,
  lon: number,
  storage: ChunkBackend,
): Promise<PointElevationResult | null> {
  if (!isWithinSRTM(lat, lon)) return null;

  const srtmName = latLonToSrtmName(lat, lon);
  const srtmBounds = srtmNameToBounds(srtmName);
  const pixel = latLonToPixel(lat, lon, srtmBounds);

  const chunkRow = Math.floor(pixel.row / 256);
  const chunkCol = Math.floor(pixel.col / 256);

  // Fetch the single chunk
  const cacheKey = `oz:chunk:${srtmName}:${chunkRow}:${chunkCol}`;
  let compressedData = await cacheGet(cacheKey);
  if (!compressedData) {
    try {
      compressedData = await storage.fetchChunk(srtmName, chunkRow, chunkCol);
      await cachePut(cacheKey, compressedData);
    } catch {
      return null;
    }
  }

  // Decompress
  let rawBytes: Uint8Array;
  try {
    rawBytes = unzlibSync(new Uint8Array(compressedData));
  } catch {
    return null;
  }

  // Compute chunk dimensions
  const chunkWidth = chunkCol < 14 ? 256 : 3601 - 14 * 256;
  const chunkHeight = chunkRow < 14 ? 256 : 3601 - 14 * 256;
  const pixels = chunkWidth * chunkHeight;

  // Undo TIFF horizontal predictor
  const rawData = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, pixels);
  const data = new Int16Array(pixels);
  for (let r = 0; r < chunkHeight; r++) {
    const rowOff = r * chunkWidth;
    data[rowOff] = rawData[rowOff];
    for (let c = 1; c < chunkWidth; c++) {
      data[rowOff + c] = data[rowOff + c - 1] + rawData[rowOff + c];
    }
  }

  // Get the pixel value
  const localRow = pixel.row - chunkRow * 256;
  const localCol = pixel.col - chunkCol * 256;

  if (localRow >= chunkHeight || localCol >= chunkWidth) return null;

  const elevation = data[localRow * chunkWidth + localCol];
  if (elevation === NODATA) return null;

  return {
    elevation,
    surfaceType: elevation < 0 ? "ocean" : "land",
    tile: srtmName.replace(".tif", ""),
  };
}
