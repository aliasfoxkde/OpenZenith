/**
 * WorldCRS84Quad tile assembler: produces 256x256 elevation grids in the
 * OGC WorldCRS84Quad tile matrix set (true EPSG:4326 / CRS84 coordinates).
 *
 * Matrix layout per OGC 2D Tile Matrix Set (17-083r2):
 *   tileMatrix 0: 2 x 1 tiles, top-left at (-180, 90), sharing the
 *   GoogleMapsCompatible level-0 scale denominator, 256px tiles.
 *   Each level doubles the width and height: 2^(z+1) columns, 2^z rows.
 *
 * Sources, mirroring the WebMercator assembler's priority:
 *   - z <= 10: AWS Terrain Tiles (EPSG:3857 XYZ) resampled per pixel center
 *     into the CRS84 grid. One 3857 fetch set spans the tile horizontally.
 *   - z > 10: direct HuggingFace SRTM 1° chunk assembly, whose 30m source
 *     resolution matters at high zoom and whose lat/lon bounds are natively
 *     rectangular here (no seams from Mercator reprojection).
 *   - whichever source is not primary is the sparsity/failure fallback.
 */

import {
  fillTileFromSrtm,
  findOverlappingSrtmTiles,
  fetchAWSTerrainTile,
  isBlacklistedSrtmTile,
  TILE_SIZE,
  NODATA,
  type TileBounds,
  type TileResult,
} from "./tile";
import type { ChunkBackend } from "./storage/backend";

// Web Mercator cannot express the poles; beyond these latitudes AWS has no
// tiles, and clamping would smear the extreme rows, so pixels report NODATA.
export const MAX_MERCATOR_LAT = 85.0511287798066;

/** Number of tile columns / rows at zoom z in WorldCRS84Quad. */
export function crs84MatrixSize(z: number): { matrixWidth: number; matrixHeight: number } {
  return { matrixWidth: 2 ** (z + 1), matrixHeight: 2 ** z };
}

/** Lat/lon bounds of a WorldCRS84Quad tile (col: 0..2^(z+1)-1, row: 0..2^z-1). */
export function crs84TileBounds(z: number, col: number, row: number): TileBounds {
  const { matrixWidth, matrixHeight } = crs84MatrixSize(z);
  const west = -180 + (360 / matrixWidth) * col;
  const north = 90 - (180 / matrixHeight) * row;
  return {
    west,
    east: west + 360 / matrixWidth,
    north,
    south: north - 180 / matrixHeight,
  };
}

/**
 * Fractional Web Mercator tile coordinates of a lat/lon at zoom za.
 * Latitudes beyond the Mercator bounds return ty = NaN (no data there).
 */
function latLonToMercatorFractional(lat: number, lon: number, za: number): { tx: number; ty: number } {
  const n = 2 ** za;
  if (Math.abs(lat) > MAX_MERCATOR_LAT) return { tx: NaN, ty: NaN };
  const latRad = (lat * Math.PI) / 180;
  return {
    tx: (n * (lon + 180)) / 360,
    ty: (n * (1 - Math.asinh(Math.tan(latRad)) / Math.PI)) / 2,
  };
}

/**
 * Sample a set of Web Mercator AWS tiles into a 256x256 CRS84 grid.
 * For each CRS84 pixel center, the containing 3857 pixel is used directly:
 * at za = z + 1 the Mercator source has ~2x the CRS84 pixel resolution, so
 * nearest-neighbour keeps all source detail without cross-tile blending.
 */
function sampleMercatorIntoCrs84(
  mercatorTiles: Map<string, Int16Array>,
  za: number,
  bounds: TileBounds,
): Int16Array {
  const data = new Int16Array(TILE_SIZE * TILE_SIZE).fill(NODATA);
  const latStep = (bounds.north - bounds.south) / TILE_SIZE;
  const lonStep = (bounds.east - bounds.west) / TILE_SIZE;

  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = bounds.north - (py + 0.5) * latStep;
    for (let px = 0; px < TILE_SIZE; px++) {
      const lon = bounds.west + (px + 0.5) * lonStep;
      const { tx, ty } = latLonToMercatorFractional(lat, lon, za);
      if (Number.isNaN(ty)) continue;

      const tile = mercatorTiles.get(`${Math.floor(tx)}:${Math.floor(ty)}`);
      if (!tile) continue;

      const localX = Math.floor((tx - Math.floor(tx)) * TILE_SIZE);
      const localY = Math.floor((ty - Math.floor(ty)) * TILE_SIZE);
      const index = localY * TILE_SIZE + localX;
      // Source tiles are 256x256; a smaller payload (degraded upstream)
      // leaves those cells NODATA instead of reading past the buffer.
      if (index >= tile.length) continue;
      const val = tile[index];
      if (val !== NODATA) {
        data[py * TILE_SIZE + px] = val;
      }
    }
  }
  return data;
}

/**
 * Fetch the AWS 3857 tiles overlapping a CRS84 bounds at zoom za.
 * The tile range comes from the bounds edges with latitudes clamped to the
 * Mercator limit — probing sample points (corners, center) misses whole tile
 * rows whenever a tile spans several 3857 tiles or touches the poles.
 * Returns null when none could be fetched (caller falls back to chunks).
 */
async function fetchMercatorCover(za: number, bounds: TileBounds): Promise<Map<string, Int16Array> | null> {
  const n = 2 ** za;
  const clampLat = (lat: number) => Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const txOf = (lon: number) => (n * (lon + 180)) / 360;
  const tyOf = (lat: number) => {
    const latRad = (clampLat(lat) * Math.PI) / 180;
    return (n * (1 - Math.asinh(Math.tan(latRad)) / Math.PI)) / 2;
  };

  // East/south edges are inset so a bounds edge landing exactly on a tile
  // boundary does not fetch the neighbouring tile no pixel center samples.
  const txMin = Math.floor(txOf(bounds.west));
  const txMax = Math.floor(txOf(bounds.east - 1e-9));
  const tyMin = Math.floor(tyOf(bounds.north));
  const tyMax = Math.floor(tyOf(bounds.south + 1e-9));

  const tiles = new Map<string, Int16Array>();
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      if (tx < 0 || tx >= n || ty < 0 || ty >= n) continue;
      const tile = await fetchAWSTerrainTile(za, tx, ty);
      if (tile) tiles.set(`${tx}:${ty}`, tile);
    }
  }
  return tiles.size > 0 ? tiles : null;
}

/**
 * Count non-nodata cells.
 */
function validCount(data: Int16Array): number {
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== NODATA) count++;
  }
  return count;
}

/**
 * Get elevation data for a WorldCRS84Quad tile.
 * Returns a 256x256 Int16Array of elevations in meters (NODATA where the
 * sources have no data: open Mercator-absent poles, gaps, failed fetches).
 */
export async function getTileDataCRS84(z: number, col: number, row: number, storage: ChunkBackend): Promise<TileResult> {
  const bounds = crs84TileBounds(z, col, row);

  if (z <= 10) {
    const tiles = await fetchMercatorCover(z + 1, bounds);
    if (tiles) {
      const data = sampleMercatorIntoCrs84(tiles, z + 1, bounds);
      // A pole-adjacent CRS84 tile legitimately contains NODATA rows beyond
      // the Mercator limit; only treat extreme sparsity as fetch failure.
      if (validCount(data) > 0) {
        return { data, width: TILE_SIZE, height: TILE_SIZE, zoom: z };
      }
    }
    // AWS missing: fall through to chunk assembly (small area at these zooms).
  }

  const srtmTiles = findOverlappingSrtmTiles(bounds);
  const data = new Int16Array(TILE_SIZE * TILE_SIZE).fill(NODATA);
  const hasBlacklisted = srtmTiles.some(isBlacklistedSrtmTile);

  for (const srtmName of srtmTiles) {
    if (isBlacklistedSrtmTile(srtmName)) continue;
    try {
      await fillTileFromSrtm(data, srtmName, bounds, storage);
    } catch {
      // Skip tiles that fail (not all 1° tiles have data)
    }
  }

  // Sparse chunk assembly at high zoom → AWS resample is the better source.
  const valid = validCount(data);
  if ((valid === 0 || valid / data.length < 0.05 || hasBlacklisted) && z > 10) {
    const tiles = await fetchMercatorCover(z + 1, bounds);
    if (tiles) {
      const resampled = sampleMercatorIntoCrs84(tiles, z + 1, bounds);
      if (validCount(resampled) > validCount(data)) {
        return { data: resampled, width: TILE_SIZE, height: TILE_SIZE, zoom: z };
      }
    }
  }

  return { data, width: TILE_SIZE, height: TILE_SIZE, zoom: z };
}
