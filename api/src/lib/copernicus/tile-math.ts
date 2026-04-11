/**
 * Copernicus DEM GLO-30 tile math.
 *
 * All Copernicus DEM GLO-30 tiles are 1x1 degree, 3600x3600 pixels.
 * Pixel spacing = 1/3600 degree (~30m at equator).
 *
 * Tile naming uses the SW (lower-left) corner:
 *   Copernicus_DSM_COG_10_{N|S}{lat:02d}_00_{E|W}{lon:03d}_00_DEM
 *
 * Coverage: global land, lat -90 to 90, lon -180 to 180.
 * Not all integer-degree tiles exist (ocean tiles are absent).
 */

const TILE_WIDTH = 3600;
const TILE_HEIGHT = 3600;
const TILE_SIZE_DEG = 1.0; // 1 degree per tile

/**
 * Convert lat/lon to Copernicus tile directory name.
 * The naming uses the SW (lower-left) corner at integer degrees.
 */
export function latLonToTileDir(lat: number, lon: number): string {
  // SW corner latitude: the tile covers [latSW, latSW+1)
  const latSW = lat >= 0 ? Math.floor(lat) : -(Math.floor(Math.abs(lat)) + 1);
  // SW corner longitude: the tile covers [lonSW, lonSW+1)
  const lonSW = lon >= 0 ? Math.floor(lon) : -(Math.floor(Math.abs(lon)) + 1);

  const latDir = latSW >= 0 ? "N" : "S";
  const lonDir = lonSW >= 0 ? "E" : "W";
  const latAbs = Math.abs(latSW);
  const lonAbs = Math.abs(lonSW);

  return `Copernicus_DSM_COG_10_${latDir}${String(latAbs).padStart(2, "0")}_00_${lonDir}${String(lonAbs).padStart(3, "0")}_00_DEM`;
}

/**
 * Parse a tile directory name to get its geographic bounds.
 * Returns null if the name doesn't match the expected pattern.
 */
export function tileDirToBounds(tileDir: string): {
  latMin: number;
  lonMin: number;
  latMax: number;
  lonMax: number;
  tileWidth: number;
  tileHeight: number;
} | null {
  const m = tileDir.match(/_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM$/);
  if (!m) return null;

  const latSign = m[1] === "N" ? 1 : -1;
  const latSW = latSign * parseInt(m[2]);
  const lonSign = m[3] === "E" ? 1 : -1;
  const lonSW = lonSign * parseInt(m[4]);

  return {
    latMin: latSW,
    latMax: latSW + TILE_SIZE_DEG,
    lonMin: lonSW,
    lonMax: lonSW + TILE_SIZE_DEG,
    tileWidth: TILE_WIDTH,
    tileHeight: TILE_HEIGHT,
  };
}

/**
 * Convert lat/lon to pixel coordinates within a Copernicus tile.
 * Origin is top-left (NW corner): row 0 = latMax, col 0 = lonMin.
 * Pixel spacing = 1/3600 degree.
 */
export function latLonToPixel(
  lat: number,
  lon: number,
  bounds: { latMin: number; lonMin: number; latMax: number; lonMax: number; tileWidth: number; tileHeight: number },
): { row: number; col: number } {
  const row = Math.round((bounds.latMax - lat) * 3600);
  const col = Math.round((lon - bounds.lonMin) * 3600);
  return {
    row: Math.max(0, Math.min(bounds.tileHeight - 1, row)),
    col: Math.max(0, Math.min(bounds.tileWidth - 1, col)),
  };
}

/** Check if a lat/lon is within Copernicus GLO-30 coverage (global land). */
export function isWithinCopernicus(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** S3 URL for a Copernicus COG tile. */
export function tileDirToUrl(tileDir: string): string {
  return `https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/${tileDir}/${tileDir}.tif`;
}
