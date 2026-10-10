/**
 * Shared terrain-sampling kernels for the z11 bilinear routes.
 *
 * Extracted (cycle V, C1) from the byte-identical closures that used to live
 * in the profile and trace routes: mercator tile/pixel projection, the tile
 * window fetch, bilinear sampling over the fetched window, and the haversine
 * distance both routes accumulate. The math is deliberately verbatim from the
 * routes it replaced — route fixtures pin profile/trace outputs, so any
 * arithmetic "cleanup" here is a behavior change and forbidden.
 */

import { latLonToTile } from "./srtm/zoom-math";
import type { ChunkBackend } from "./storage/backend";
import { getTileData } from "./tile";

/** Sentinel elevation for missing tiles / all-nodata corners (SRTM int16). */
export const ELEVATION_NODATA = -32768;

/** Web-mercator tile coordinates for a lat/lon at zoom z. */
export function tileIndexFor(lat: number, lon: number, z: number): { tileX: number; tileY: number } {
  const n2 = 2 ** z;
  const tileX = Math.floor(((lon + 180) / 360) * n2);
  const latRad = (lat * Math.PI) / 180;
  const tileY = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n2);
  return { tileX, tileY };
}

/**
 * Fractional pixel position of a lat/lon inside its 256x256 tile, resolved to
 * the clamped bilinear corner lattice (x0/x1, y0/y1) and fractional offsets.
 */
export function bilinearLattice(
  lat: number,
  lon: number,
  z: number,
): { x0: number; x1: number; y0: number; y1: number; fx: number; fy: number } {
  const n2 = 2 ** z;
  const { tileX, tileY } = tileIndexFor(lat, lon, z);
  const latRad = (lat * Math.PI) / 180;
  const px = ((lon + 180) / 360) * n2 * 256 - tileX * 256;
  const py = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n2 * 256 - tileY * 256;
  const x0 = Math.max(0, Math.min(255, Math.floor(px)));
  const y0 = Math.max(0, Math.min(255, Math.floor(py)));
  const x1 = Math.min(255, x0 + 1);
  const y1 = Math.min(255, y0 + 1);
  return { x0, x1, y0, y1, fx: px - x0, fy: py - y0 };
}

/**
 * Inclusive tile-window bounds covering a `radius`-pixel neighborhood around
 * (latDeg, lonDeg) at zoom `z` — the grid the profile and trace routes sample
 * over. Extracted (cycle VI, D1) from the 19 lines both routes carried inline;
 * the statement order is verbatim from them, per the fixtures-pin-outputs
 * rule above.
 */
export function tileWindowBounds(
  z: number,
  latDeg: number,
  lonDeg: number,
  radius: number,
): { tileXMin: number; tileXMax: number; tileYMin: number; tileYMax: number } {
  const { x: cx, y: cy } = latLonToTile(latDeg, lonDeg, z);
  const xFrac = ((lonDeg + 180) / 360) * 2 ** z - cx;
  const latRad = (latDeg * Math.PI) / 180;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z - cy;

  const gridRows = 2 * radius + 1;
  const gridCols = 2 * radius + 1;

  const centerPixelX = cx * 256 + xFrac * 256;
  const centerPixelY = cy * 256 + yFrac * 256;
  const minPixelX = Math.floor(centerPixelX - radius);
  const minPixelY = Math.floor(centerPixelY - radius);

  const tileXMin = Math.floor(minPixelX / 256);
  const tileXMax = Math.floor((minPixelX + gridCols - 1) / 256);
  const tileYMin = Math.floor(minPixelY / 256);
  const tileYMax = Math.floor((minPixelY + gridRows - 1) / 256);
  return { tileXMin, tileXMax, tileYMin, tileYMax };
}

/**
 * Fetch every tile in an inclusive [txMin..txMax] x [tyMin..tyMax] window.
 * A tile that fails to fetch is simply absent from the map — the sampler
 * reports NODATA for points that land in it (this mirrors the old routes'
 * `catch { /* unavailable *\/ }` behavior).
 */
export async function fetchTileWindow(
  z: number,
  txMin: number,
  txMax: number,
  tyMin: number,
  tyMax: number,
  storage: ChunkBackend,
): Promise<Map<string, Int16Array>> {
  const tileDataMap = new Map<string, Int16Array>();
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      try {
        const tile = await getTileData(z, tx, ty, storage);
        tileDataMap.set(`${tx}/${ty}`, tile.data);
      } catch {
        /* unavailable */
      }
    }
  }
  return tileDataMap;
}

/**
 * Bilinear sampler over a fetched tile window. Returns ELEVATION_NODATA when
 * the point's tile is missing or all four corners are nodata; otherwise the
 * bilinear blend of the four corners (verbatim arithmetic from the routes).
 */
export function makeBilinearSampler(
  z: number,
  tileDataMap: Map<string, Int16Array>,
): (lat: number, lon: number) => number {
  return (lat: number, lon: number): number => {
    const { tileX, tileY } = tileIndexFor(lat, lon, z);
    const tile = tileDataMap.get(`${tileX}/${tileY}`);
    if (!tile) return ELEVATION_NODATA;

    const { x0, x1, y0, y1, fx, fy } = bilinearLattice(lat, lon, z);
    // bounds: x0/x1 and y0/y1 clamped to [0,255]; tile is a 256x256 (65536) grid
    const h00 = tile[y0 * 256 + x0]!;
    const h10 = tile[y0 * 256 + x1]!;
    const h01 = tile[y1 * 256 + x0]!;
    const h11 = tile[y1 * 256 + x1]!;

    if (h00 === ELEVATION_NODATA && h10 === ELEVATION_NODATA && h01 === ELEVATION_NODATA && h11 === ELEVATION_NODATA) {
      return ELEVATION_NODATA;
    }
    return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
  };
}

/** Great-circle distance in metres between two lat/lon points (haversine). */
export function haversineMeters(latA: number, lonA: number, latB: number, lonB: number): number {
  const R = 6371000;
  const dLat = ((latB - latA) * Math.PI) / 180;
  const dLon = ((lonB - lonA) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((latA * Math.PI) / 180) * Math.cos((latB * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
