/**
 * GEBCO 2025 tile math.
 *
 * GEBCO 2025 grid is 15 arc-second resolution (~450m at equator).
 * The data is organized as 8 quadrant files (90°x90°), each 21600x21600 pixels.
 *
 * CEDA naming: gebco_2025_n{north}_s{south}_w{west}_e{east}.tif
 *   Northern hemisphere: n90.0_s0.0
 *   Southern hemisphere: n0.0_s-90.0
 *   Longitude bands: w-180.0_e-90.0, w-90.0_e0.0, w0.0_e90.0, w90.0_e180.0
 *
 * Each quadrant: 21600x21600 Int16 pixels, 240 pixels/degree, strip-based (21600x1 strips).
 */

const PIXELS_PER_DEG = 240; // 3600 arc-seconds / 15 arc-seconds
const QUAD_PIXELS = 21600; // pixels per quadrant side

/**
 * Convert lat/lon to the GEBCO quadrant filename.
 */
export function latLonToQuadName(lat: number, lon: number): string {
  const latBand = lat >= 0 ? "n90.0_s0.0" : "n0.0_s-90.0";

  let lonBand: string;
  if (lon < -90) lonBand = "w-180.0_e-90.0";
  else if (lon < 0) lonBand = "w-90.0_e0.0";
  else if (lon < 90) lonBand = "w0.0_e90.0";
  else lonBand = "w90.0_e180.0";

  return `gebco_2025_${latBand}_${lonBand}.tif`;
}

/**
 * Get the geographic bounds of a quadrant.
 */
export function quadNameToBounds(quadName: string): {
  latMin: number;
  lonMin: number;
  latMax: number;
  lonMax: number;
} | null {
  const m = quadName.match(
    /gebco_2025_n([\d.-]+)_s([\d.-]+)_w([\d.-]+)_e([\d.-]+)\.tif/,
  );
  if (!m) return null;

  return {
    latMax: parseFloat(m[1]),
    latMin: parseFloat(m[2]),
    lonMin: parseFloat(m[3]),
    lonMax: parseFloat(m[4]),
  };
}

/**
 * Convert lat/lon to pixel coordinates within a GEBCO quadrant.
 * Origin is top-left (NW corner): row 0 = latMax, col 0 = lonMin.
 */
export function latLonToPixel(
  lat: number,
  lon: number,
  bounds: { latMin: number; lonMin: number; latMax: number; lonMax: number },
): { row: number; col: number } {
  const row = Math.round((bounds.latMax - lat) * PIXELS_PER_DEG);
  const col = Math.round((lon - bounds.lonMin) * PIXELS_PER_DEG);
  return {
    row: Math.max(0, Math.min(QUAD_PIXELS - 1, row)),
    col: Math.max(0, Math.min(QUAD_PIXELS - 1, col)),
  };
}

/**
 * URL for a GEBCO quadrant file.
 * Used by the tile server route to locate files.
 */
export function quadNameToUrl(quadName: string): string {
  if (process.env.GEBCO_TILE_URL) {
    return `${process.env.GEBCO_TILE_URL}/${quadName}`;
  }
  return quadName;
}
