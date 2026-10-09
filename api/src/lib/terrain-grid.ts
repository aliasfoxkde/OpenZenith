/**
 * Shared terrain-route kernel — the DEM-grid machinery every point-grid
 * terrain route (slope, aspect, twi, streams, watershed) used to carry as
 * its own copy: parameter clamps, fractional-pixel centering, the tile-fetch
 * loop, bilinear sampling into a Float32Array grid, the OZT2→merged
 * pour-point elevation gate, and the D8/slope hydrology helpers.
 *
 * Responses are byte-identical to the pre-extraction routes: the math is
 * moved verbatim, and each route keeps its own response shaping. The tile
 * and backend reads go through the same module specifiers the routes used,
 * so the route test suites' `vi.mock` of `@/lib/tile`,
 * `@/lib/storage/backend`, and `@/lib/point-elevation` covers this module
 * unchanged.
 */

import { getTileData } from "@/lib/tile";
import { getPointElevation } from "@/lib/point-elevation";
import { HuggingFaceChunkBackend, OZT2HuggingFaceBackend } from "@/lib/storage/backend";
import { latLonToTile } from "@/lib/srtm/zoom-math";

/** SRTM nodata sentinel used by every terrain route. */
export const TERRAIN_NODATA = -32768;

/** Merged-chunk backend shared by the terrain routes (fallback / direct access). */
export const TERRAIN_HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

/** OZT2 backend shared by the terrain routes (primary z10 elevation source). */
export const TERRAIN_OZT2_BACKEND = new OZT2HuggingFaceBackend({
  repoId: "aliasfox/srtm30m-ozt2-v2",
  fallbackRepoId: "aliasfox/srtm30m-merged",
  zoom: 10,
});

/** D8 neighbor offsets, direction-coded 0=E CCW to 7=SE (matches d8FlowDirection). */
export const D8_DR = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const D8_DC = [1, 1, 0, -1, -1, -1, 0, 1] as const;

/** Validated grid parameters shared by every point-grid terrain route. */
export interface TerrainGridParams {
  lat: number;
  lon: number;
  radius: number;
  zoom: number;
}

/** Assembled DEM grid plus the geometry the response builders need. */
export interface TerrainGrid extends TerrainGridParams {
  /** Row-major (2*radius+1)² grid; TERRAIN_NODATA where no data. */
  dem: Float32Array;
  rows: number;
  cols: number;
  cellSizeDeg: number;
  cellSizeM: number;
  /** Global-pixel bounds of the grid — the tile-range footprint. */
  tileXMin: number;
  tileXMax: number;
  tileYMin: number;
  tileYMax: number;
  /** Global pixel coordinate of grid cell (row 0, col 0) — grid→lat/lon mapping. */
  minPixelX: number;
  minPixelY: number;
}

/**
 * Fetch every tile under the grid footprint and bilinearly sample the
 * (2*radius+1)² pixel grid centered on (lat, lon). Identical math to the
 * block each route carried: NODATA where a tile is unavailable, and NODATA
 * where all four neighbors are nodata (partial-neighbor cells interpolate).
 */
export async function assembleTerrainGrid(params: TerrainGridParams): Promise<TerrainGrid> {
  const { lat, lon, radius, zoom } = params;
  const gridRows = 2 * radius + 1;
  const gridCols = 2 * radius + 1;
  const n = 2 ** zoom;
  const cellSizeDeg = 180 / (n * 256);
  const cellSizeM = cellSizeDeg * 111320;

  const { x: cx, y: cy } = latLonToTile(lat, lon, zoom);
  const xFrac = ((lon + 180) / 360) * n - cx;
  const latRad = (lat * Math.PI) / 180;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - cy;
  const centerPixelX = cx * 256 + xFrac * 256;
  const centerPixelY = cy * 256 + yFrac * 256;

  const minPixelX = Math.floor(centerPixelX - radius);
  const maxPixelX = Math.ceil(centerPixelX + radius);
  const minPixelY = Math.floor(centerPixelY - radius);
  const maxPixelY = Math.ceil(centerPixelY + radius);

  const tileXMin = Math.floor(minPixelX / 256);
  const tileXMax = Math.floor(maxPixelX / 256);
  const tileYMin = Math.floor(minPixelY / 256);
  const tileYMax = Math.floor(maxPixelY / 256);

  const tileDataMap = new Map<string, Int16Array>();
  for (let ty = tileYMin; ty <= tileYMax; ty++) {
    for (let tx = tileXMin; tx <= tileXMax; tx++) {
      const key = `${tx}/${ty}`;
      try {
        const tile = await getTileData(zoom, tx, ty, TERRAIN_HF_BACKEND);
        tileDataMap.set(key, tile.data);
      } catch {
        // unavailable tile — grid cells over it become NODATA below
      }
    }
  }

  const dem = new Float32Array(gridRows * gridCols);
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const globalX = minPixelX + c;
      const globalY = minPixelY + r;
      const tileX = Math.floor(globalX / 256);
      const tileY = Math.floor(globalY / 256);
      const key = `${tileX}/${tileY}`;
      const tile = tileDataMap.get(key);

      if (!tile) {
        dem[r * gridCols + c] = TERRAIN_NODATA;
        continue;
      }

      const px = globalX - tileX * 256;
      const py = globalY - tileY * 256;
      const x0 = Math.max(0, Math.min(255, px));
      const y0 = Math.max(0, Math.min(255, py));
      const x1 = Math.min(255, x0 + 1);
      const y1 = Math.min(255, y0 + 1);
      const fx = px - x0;
      const fy = py - y0;

      const w = 256;
      // bounds: x0/x1/y0/y1 are clamped to [0,255] above and tile is 256*256
      const h00 = tile[y0 * w + x0]!;
      const h10 = tile[y0 * w + x1]!;
      const h01 = tile[y1 * w + x0]!;
      const h11 = tile[y1 * w + x1]!;

      if (h00 === TERRAIN_NODATA && h10 === TERRAIN_NODATA && h01 === TERRAIN_NODATA && h11 === TERRAIN_NODATA) {
        dem[r * gridCols + c] = TERRAIN_NODATA;
        continue;
      }

      dem[r * gridCols + c] = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
    }
  }

  return {
    ...params,
    dem,
    rows: gridRows,
    cols: gridCols,
    cellSizeDeg,
    cellSizeM,
    tileXMin,
    tileXMax,
    tileYMin,
    tileYMax,
    minPixelX,
    minPixelY,
  };
}

/**
 * Pour-point elevation gate: OZT2 primary, merged chunks fallback.
 * Returns the raw value (or null when both sources miss) — the caller owns
 * the `<= TERRAIN_NODATA` comparison because the routes' contract treats a
 * comparison-throwing value as "gate failed, proceed to grid assembly",
 * not as missing data.
 */
export async function resolveStartElevation(lat: number, lon: number): Promise<number | null> {
  let startElevVal: number | null = null;
  try {
    startElevVal = await TERRAIN_OZT2_BACKEND.getElevation(lat, lon);
  } catch {
    // Fall through to merged chunks
  }
  if (startElevVal === null) {
    try {
      const fallback = await getPointElevation(lat, lon, TERRAIN_HF_BACKEND);
      if (fallback) startElevVal = fallback.elevation;
    } catch {
      // Fall through
    }
  }
  return startElevVal;
}

/**
 * D8 flow direction: steepest-descent-of-8 neighbor coding (0=E, CCW to 7=SE;
 * -1 = flat or nodata). Shared by twi, streams, and watershed verbatim.
 */
export function d8FlowDirection(dem: Float32Array, rows: number, cols: number, nodata: number): Int8Array {
  const flowDir = new Int8Array(rows * cols).fill(-1);
  const DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
  // bounds: idx/nIdx are row-major cells with nr/nc range-checked above, all
  // inside [0, rows*cols); d < 8 === D8_DR/D8_DC/DIST length
  const rd = (i: number): number => dem[i]!;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (rd(idx) <= nodata) continue;
      let maxSlope = 0;
      let bestDir = -1;
      for (let d = 0; d < 8; d++) {
        const nr = r + D8_DR[d]!;
        const nc = c + D8_DC[d]!;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nIdx = nr * cols + nc;
        if (rd(nIdx) <= nodata) continue;
        const slope = (rd(idx) - rd(nIdx)) / DIST[d]!;
        if (slope > maxSlope) {
          maxSlope = slope;
          bestDir = d;
        }
      }
      flowDir[idx] = bestDir;
    }
  }
  return flowDir;
}

/**
 * Iterative flow accumulation over a D8 grid (cell counts, min 1). Shared
 * by twi and streams verbatim.
 */
export function flowAccumulation(flowDir: Int8Array, rows: number, cols: number): Uint32Array {
  const accum = new Uint32Array(rows * cols).fill(1);
  let changed = true;
  let iter = 0;
  while (changed && iter++ < rows * cols) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // bounds: idx/nIdx are row-major cells inside [0, rows*cols), matching
        // flowDir/accum length; d < 8 === D8_DR/D8_DC length
        const idx = r * cols + c;
        const d = flowDir[idx]!;
        if (d === -1) continue;
        const nr = r + D8_DR[d]!;
        const nc = c + D8_DC[d]!;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const nIdx = nr * cols + nc;
        const newVal = accum[idx]! + (accum[nIdx]! > 0 ? 1 : 0);
        if (newVal > accum[nIdx]!) {
          accum[nIdx] = newVal;
          changed = true;
        }
      }
    }
  }
  return accum;
}

/**
 * The 3×3 Horn window around (r,c): null when the center or any neighbor is
 * nodata (border callers stay in the r∈[1,rows-2] loop so bounds are valid).
 * Order: a b c / d . f / g h i.
 */
function hornWindow3x3(
  dem: Float32Array,
  rows: number,
  cols: number,
  r: number,
  c: number,
  nodata: number,
): [number, number, number, number, number, number, number, number] | null {
  // bounds: callers iterate r in [1, rows-2], c in [1, cols-2], so every
  // (rr, cc) neighbor stays a valid row-major cell of dem
  const at = (rr: number, cc: number): number => dem[rr * cols + cc]!;
  const a = at(r - 1, c - 1);
  const b = at(r - 1, c);
  const c_ = at(r - 1, c + 1);
  const d = at(r, c - 1);
  const f = at(r, c + 1);
  const g = at(r + 1, c - 1);
  const h = at(r + 1, c);
  const i = at(r + 1, c + 1);
  if (
    at(r, c) <= nodata ||
    a <= nodata ||
    b <= nodata ||
    c_ <= nodata ||
    d <= nodata ||
    f <= nodata ||
    g <= nodata ||
    h <= nodata ||
    i <= nodata
  ) {
    return null;
  }
  return [a, b, c_, d, f, g, h, i];
}

/**
 * Horn-method slope in degrees from a DEM grid; border cells and cells
 * without a full valid 3×3 window are NaN. Shared by slope and twi verbatim.
 */
export function computeSlope(
  dem: Float32Array,
  rows: number,
  cols: number,
  cellSizeM: number,
  nodata: number,
): Float32Array {
  const result = new Float32Array(rows * cols).fill(NaN);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx = r * cols + c;
      const win = hornWindow3x3(dem, rows, cols, r, c, nodata);
      if (!win) continue; // center or neighbor nodata — cell stays NaN
      const [a, b, c_, d, f, g, h, i] = win;
      const dzDx = (c_ + 2 * f + i - (a + 2 * d + g)) / (8 * cellSizeM);
      const dzDy = (a + 2 * b + c_ - (g + 2 * h + i)) / (8 * cellSizeM);
      result[idx] = (Math.atan(Math.sqrt(dzDx * dzDx + dzDy * dzDy)) * 180) / Math.PI;
    }
  }
  return result;
}

/**
 * Aspect — compass direction of steepest descent in degrees.
 * 0=N, 90=E, 180=S, 270=W; flat cells = -1; border/nodata = NaN.
 * Moved verbatim from the aspect route; shape mirrors computeSlope.
 */
export function computeAspect(
  dem: Float32Array,
  rows: number,
  cols: number,
  cellSizeM: number,
  nodata: number,
): Float32Array {
  // Border cells lack a full 3×3 window — keep them NaN so they are
  // excluded from direction bins and emitted as null, not fake values.
  const result = new Float32Array(rows * cols).fill(NaN);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const idx = r * cols + c;
      const win = hornWindow3x3(dem, rows, cols, r, c, nodata);
      if (!win) continue;
      const [a, b, c_, d, f, g, h, i] = win;
      const dzDx = (c_ + 2 * f + i - (a + 2 * d + g)) / (8 * cellSizeM);
      const dzDy = (a + 2 * b + c_ - (g + 2 * h + i)) / (8 * cellSizeM);

      // Flat — no descent direction
      if (Math.abs(dzDx) < 1e-10 && Math.abs(dzDy) < 1e-10) {
        result[idx] = -1;
        continue;
      }

      // dzDy is north-positive (row 0 = north, so +rows moves south) and
      // dzDx is east-positive; atan2 over them is the gradient angle in
      // math convention. (90 - angle + 180) % 360 converts to the compass
      // downslope direction: a north-rising slope faces south (180).
      const aspectRad = Math.atan2(dzDy, dzDx);
      const aspectDeg = (90 - aspectRad * (180 / Math.PI) + 180) % 360;
      result[idx] = Math.round(aspectDeg * 10) / 10;
    }
  }
  return result;
}

/**
 * Response-grid decimation: walk the computed grid at stride `ds` (chosen by
 * the routes from radius), keeping cells the `keep` predicate accepts and
 * mapping kept values through `transform` (rounding lives there).
 */
export function decimateGrid(
  grid: Float32Array,
  rows: number,
  cols: number,
  ds: number,
  keep: (v: number) => boolean,
  transform: (v: number) => number,
): (number | null)[][] {
  const sampled: (number | null)[][] = [];
  for (let r = 0; r < rows; r += ds) {
    const row: (number | null)[] = [];
    for (let c = 0; c < cols; c += ds) {
      // bounds: r < rows and c < cols, so the row-major index is < grid.length
      const v = grid[r * cols + c]!;
      row.push(keep(v) ? transform(v) : null);
    }
    sampled.push(row);
  }
  return sampled;
}
