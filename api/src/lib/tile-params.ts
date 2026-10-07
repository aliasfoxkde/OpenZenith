/**
 * Shared strict parsing for {z}/{x}/{y} tile route parameters.
 *
 * Two failure classes are distinguished so clients get actionable statuses:
 *   400 — the path segment is not an integer, or zoom is outside the route's
 *         supported range (a malformed request);
 *   404 — the coordinates are integers but outside the 2^z tile grid (a
 *         well-formed request for a tile that does not exist).
 *
 * The strict integer rule is deliberate: parseInt("3abc") yields 3, which let
 * truncated garbage coordinates slip through validation and burn a full DEM
 * assembly pass before failing on missing data.
 */

export interface TileParams {
  z: number;
  x: number;
  y: number;
}

export type TileParamParse =
  | ({ ok: true } & TileParams)
  | { ok: false; status: number; message: string };

const STRICT_INT = /^-?[0-9]+$/;

function parseTileInt(value: string): number {
  return STRICT_INT.test(value) ? Number.parseInt(value, 10) : Number.NaN;
}

/**
 * Parse and validate slippy-map tile coordinates.
 *
 * @param z raw zoom path segment
 * @param x raw x path segment
 * @param y raw y path segment
 * @param bounds the route's supported zoom range (inclusive)
 */
export function parseTileParams(
  z: string,
  x: string,
  y: string,
  bounds: { minZoom: number; maxZoom: number },
): TileParamParse {
  const zoom = parseTileInt(z);
  const tileX = parseTileInt(x);
  const tileY = parseTileInt(y);

  if (isNaN(zoom) || isNaN(tileX) || isNaN(tileY)) {
    return { ok: false, status: 400, message: "Invalid tile coordinates" };
  }
  if (zoom < bounds.minZoom || zoom > bounds.maxZoom) {
    return {
      ok: false,
      status: 400,
      message: `Zoom must be between ${bounds.minZoom} and ${bounds.maxZoom}`,
    };
  }
  const maxTile = Math.pow(2, zoom) - 1;
  if (tileX < 0 || tileX > maxTile || tileY < 0 || tileY > maxTile) {
    return {
      ok: false,
      status: 404,
      message: `Tile out of range for zoom ${zoom} (max ${maxTile})`,
    };
  }
  return { ok: true, z: zoom, x: tileX, y: tileY };
}
