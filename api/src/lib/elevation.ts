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
    compressedData = await storage.fetchChunk(srtmName, chunkRow, chunkCol);
    await cachePut(chunkKey, compressedData);
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
  const data = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, pixels);

  // Extract elevation
  const elevation = data[localRow * chunkWidth + localCol];

  return {
    elevation: elevation === NODATA ? null : elevation,
    unit: "meters",
    location: { lat, lon },
    source: "srtm30m",
    srtmTile: srtmName,
    resolution: 30,
  };
}
