/**
 * EGM96 geoid undulation lookup, decoded from the bundled 30' grid.
 *
 * SRTM heights are already EGM96 orthometric, so `datum=egm96` (the default
 * everywhere) is a no-op by construction. Asking for `datum=ellipsoid` returns
 * h = H + N, where N is the undulation sampled here.
 *
 * The grid is decoded lazily on first use and cached for the isolate's
 * lifetime: ~260k int16 nodes, two cumulative sums, well under a millisecond.
 */

import {
  EGM96_GRID_COLS,
  EGM96_GRID_LAT0,
  EGM96_GRID_LON0,
  EGM96_GRID_PAYLOAD,
  EGM96_GRID_ROWS,
  EGM96_GRID_STEP_DEG,
} from "./egm96-grid";

/** Undulation grid in centimetres, rows +90° → -90°, cols -180° → +179.5°. */
let grid: Int16Array | null = null;
/** In-flight decode, so concurrent first callers share one decompression. */
let decoding: Promise<void> | null = null;

/**
 * Decode the embedded payload into the undulation grid.
 *
 * The payload stores second differences (longitude first, then latitude), so
 * two cumulative sums recover the centimetre values. Both run in int32: the
 * intermediate sums reach ~±10,700 cm, but int16 overflow is silent, so the
 * accumulator is widened before the first sum.
 */
async function decodeEgm96Grid(): Promise<Int16Array> {
  // workerd and Node both ship DecompressionStream("gzip"); the payload is
  // opaque gzip bytes, so no WASM or hand-rolled inflate is needed.
  const binary = Uint8Array.from(atob(EGM96_GRID_PAYLOAD), (c) => c.charCodeAt(0));
  const stream = new Response(new Blob([binary]).stream().pipeThrough(new DecompressionStream("gzip")));
  const deltas = new Int16Array(await stream.arrayBuffer());

  const recovered = new Int32Array(EGM96_GRID_ROWS * EGM96_GRID_COLS);
  // Latitude diff first: row 0 of the delta array is already absolute.
  for (let i = 0; i < EGM96_GRID_ROWS; i++) {
    const row = i * EGM96_GRID_COLS;
    for (let j = 0; j < EGM96_GRID_COLS; j++) {
      recovered[row + j] = deltas[row + j] + (i > 0 ? recovered[row - EGM96_GRID_COLS + j] : 0);
    }
  }
  // Then the longitude diff within each recovered row.
  for (let i = 0; i < EGM96_GRID_ROWS; i++) {
    const row = i * EGM96_GRID_COLS;
    for (let j = 1; j < EGM96_GRID_COLS; j++) {
      recovered[row + j] += recovered[row + j - 1];
    }
  }

  return new Int16Array(recovered); // node values fit int16 by construction
}

/**
 * Decode the grid if it is not already resident. Idempotent and safe to call
 * concurrently — the in-flight promise is shared.
 */
export async function loadEgm96Grid(): Promise<void> {
  if (grid) return;
  if (!decoding) {
    decoding = decodeEgm96Grid().then((decoded) => {
      grid = decoded;
    });
  }
  await decoding;
}

/** Test hook: drop the decoded grid so the decode path can run again. */
export function resetEgm96Grid(): void {
  grid = null;
  decoding = null;
}

/**
 * EGM96 geoid undulation N in metres: the height of the geoid above the
 * WGS84 ellipsoid. Add it to an orthometric (SRTM) height to get the
 * ellipsoidal height: h = H + N.
 *
 * Longitude wraps across the antimeridian; latitude clamps to ±90°.
 * Requires the grid to be resident — call `loadEgm96Grid()` first.
 *
 * @param lat - Latitude in degrees.
 * @param lon - Longitude in degrees.
 * @returns Undulation in metres, rounded to the grid's 1 cm quantisation.
 */
export function egm96Undulation(lat: number, lon: number): number {
  if (!grid) throw new Error("EGM96 grid not loaded — call loadEgm96Grid() first");

  // Fractional row/column of the query point. Latitude is clamped before the
  // division so a latitude of exactly +90 still lands on row 0, and the +1
  // neighbour below always exists.
  const fi = Math.min(Math.max((EGM96_GRID_LAT0 - lat) / EGM96_GRID_STEP_DEG, 0), EGM96_GRID_ROWS - 1);
  const fj = (lon - EGM96_GRID_LON0) / EGM96_GRID_STEP_DEG;

  const i0 = Math.min(Math.floor(fi), EGM96_GRID_ROWS - 2);
  // Longitude is periodic: the column after the last one is column 0.
  const j0 = Math.floor(fj) % EGM96_GRID_COLS;
  const j1 = (j0 + 1) % EGM96_GRID_COLS;
  const di = fi - i0;
  const dj = fj - Math.floor(fj);

  const row0 = i0 * EGM96_GRID_COLS;
  const row1 = row0 + EGM96_GRID_COLS;
  const cm =
    grid[row0 + j0] * (1 - di) * (1 - dj) +
    grid[row1 + j0] * di * (1 - dj) +
    grid[row0 + j1] * (1 - di) * dj +
    grid[row1 + j1] * di * dj;

  return Math.round(cm) / 100;
}

/**
 * Convenience wrapper: loads the grid on first call, then samples.
 *
 * @returns Undulation in metres.
 */
export async function egm96UndulationAt(lat: number, lon: number): Promise<number> {
  await loadEgm96Grid();
  return egm96Undulation(lat, lon);
}
