/**
 * Tile assembler: produces 256x256 elevation grids for slippy map tiles.
 *
 * For a given z/x/y tile:
 * 1. Compute lat/lon bounds
 * 2. Find which SRTM 1° tiles overlap
 * 3. Fetch pre-extracted 256x256 chunks
 * 4. Sample/interpolate to produce a 256x256 Int16Array
 */

import { unzlibSync } from "fflate";
import {
  latLonToSrtmName,
  srtmNameToBounds,
  latLonToPixel,
  isWithinSRTM,
  SRTM_BOUNDS,
} from "./srtm/tile-math";
import { tileToLatLon } from "./srtm/zoom-math";
import type { ChunkBackend } from "./storage/backend";
import { cacheGet, cachePut } from "./storage/cache";

const TILE_SIZE = 256;
const NODATA = -32768;

export interface TileResult {
  data: Int16Array;
  width: number;
  height: number;
  zoom: number;
}

/**
 * Get elevation tile data for a slippy map tile.
 * Returns a 256x256 Int16Array of elevation values in meters.
 * NoData values are set to -32768.
 */
export async function getTileData(
  z: number,
  x: number,
  y: number,
  storage: ChunkBackend,
): Promise<TileResult> {
  const bounds = tileToLatLon(z, x, y);

  // Check if any part of this tile overlaps SRTM coverage
  if (
    bounds.south > SRTM_BOUNDS.latMax ||
    bounds.north < SRTM_BOUNDS.latMin ||
    bounds.west > SRTM_BOUNDS.lonMax ||
    bounds.east < SRTM_BOUNDS.lonMin
  ) {
    return {
      data: new Int16Array(TILE_SIZE * TILE_SIZE).fill(NODATA),
      width: TILE_SIZE,
      height: TILE_SIZE,
      zoom: z,
    };
  }

  // Find all SRTM tiles that overlap
  const srtmTiles = findOverlappingSrtmTiles(bounds);
  const data = new Int16Array(TILE_SIZE * TILE_SIZE).fill(NODATA);

  // Process each SRTM tile
  for (const srtmName of srtmTiles) {
    try {
      await fillTileFromSrtm(data, srtmName, bounds, storage);
    } catch {
      // Skip tiles that fail (not all 1° tiles have data)
    }
  }

  return { data, width: TILE_SIZE, height: TILE_SIZE, zoom: z };
}

/**
 * Find all SRTM tile names that overlap with the given bounds.
 */
function findOverlappingSrtmTiles(bounds: {
  north: number;
  south: number;
  east: number;
  west: number;
}): string[] {
  const tiles: Set<string> = new Set();

  const lats = [
    bounds.north - 0.001,
    (bounds.north + bounds.south) / 2,
    bounds.south + 0.001,
  ];
  const lons = [
    bounds.west + 0.001,
    (bounds.west + bounds.east) / 2,
    bounds.east - 0.001,
  ];

  for (const lat of lats) {
    for (const lon of lons) {
      if (isWithinSRTM(lat, lon)) {
        tiles.add(latLonToSrtmName(lat, lon));
      }
    }
  }

  return Array.from(tiles);
}

/**
 * Fill the output tile array with elevation data from one SRTM tile.
 * Fetches pre-extracted chunks and samples pixels to the output grid.
 */
async function fillTileFromSrtm(
  output: Int16Array,
  srtmName: string,
  tileBounds: { north: number; south: number; east: number; west: number },
  storage: ChunkBackend,
): Promise<void> {
  const srtmBounds = srtmNameToBounds(srtmName);

  // Find the overlap region
  const overlapNorth = Math.min(tileBounds.north, srtmBounds.latMax);
  const overlapSouth = Math.max(tileBounds.south, srtmBounds.latMin);
  const overlapWest = Math.max(tileBounds.west, srtmBounds.lonMin);
  const overlapEast = Math.min(tileBounds.east, srtmBounds.lonMax);

  if (overlapNorth <= overlapSouth || overlapWest >= overlapEast) return;

  // Convert overlap bounds to SRTM pixel range
  const startPixel = latLonToPixel(overlapNorth, overlapWest, srtmBounds);
  const endPixel = latLonToPixel(overlapSouth, overlapEast, srtmBounds);

  // Determine which chunks we need
  const startChunkRow = Math.floor(startPixel.row / 256);
  const startChunkCol = Math.floor(startPixel.col / 256);
  const endChunkRow = Math.floor(endPixel.row / 256);
  const endChunkCol = Math.floor(endPixel.col / 256);

  // Fetch and decompress needed chunks
  const chunkCache = new Map<
    string,
    { data: Int16Array; width: number; height: number; chunkRow: number; chunkCol: number }
  >();

  for (let cr = startChunkRow; cr <= endChunkRow; cr++) {
    for (let cc = startChunkCol; cc <= endChunkCol; cc++) {
      const cacheKey = `${cr}:${cc}`;
      if (chunkCache.has(cacheKey)) continue;

      const chunkKey = `oz:chunk:${srtmName}:${cr}:${cc}`;
      let compressedData = await cacheGet(chunkKey);
      if (!compressedData) {
        compressedData = await storage.fetchChunk(srtmName, cr, cc);
        await cachePut(chunkKey, compressedData);
      }

      // Decompress
      const rawBytes = unzlibSync(new Uint8Array(compressedData));

      // Compute chunk dimensions (edge tiles may be smaller)
      const chunkWidth =
        cc < 14 ? 256 : 3601 - 14 * 256;
      const chunkHeight =
        cr < 14 ? 256 : 3601 - 14 * 256;
      const pixels = chunkWidth * chunkHeight;

      // Undo TIFF horizontal predictor (predictor=2).
      // SRTM GeoTIFF tiles store horizontal differences; undo by cumulative sum per row.
      const rawData = new Int16Array(
        rawBytes.buffer,
        rawBytes.byteOffset,
        pixels,
      );
      const data = new Int16Array(pixels);
      for (let r = 0; r < chunkHeight; r++) {
        const rowOff = r * chunkWidth;
        data[rowOff] = rawData[rowOff]; // first pixel is the absolute value
        for (let c = 1; c < chunkWidth; c++) {
          data[rowOff + c] = data[rowOff + c - 1] + rawData[rowOff + c];
        }
      }

      chunkCache.set(cacheKey, { data, width: chunkWidth, height: chunkHeight, chunkRow: cr, chunkCol: cc });
    }
  }

  // Sample SRTM pixels and map to output grid
  const latStep = (tileBounds.north - tileBounds.south) / TILE_SIZE;
  const lonStep = (tileBounds.east - tileBounds.west) / TILE_SIZE;

  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = tileBounds.north - (py + 0.5) * latStep;
    if (lat > srtmBounds.latMax || lat < srtmBounds.latMin) continue;

    for (let px = 0; px < TILE_SIZE; px++) {
      const lon = tileBounds.west + (px + 0.5) * lonStep;
      if (lon < srtmBounds.lonMin || lon > srtmBounds.lonMax) continue;

      const pixel = latLonToPixel(lat, lon, srtmBounds);
      const chunkRow = Math.floor(pixel.row / 256);
      const chunkCol = Math.floor(pixel.col / 256);

      const chunk = chunkCache.get(`${chunkRow}:${chunkCol}`);
      if (!chunk) continue;

      const localRow = pixel.row - chunkRow * 256;
      const localCol = pixel.col - chunkCol * 256;

      if (localRow < chunk.height && localCol < chunk.width) {
        const val = chunk.data[localRow * chunk.width + localCol];
        if (val !== NODATA) {
          output[py * TILE_SIZE + px] = val;
        }
      }
    }
  }
}
