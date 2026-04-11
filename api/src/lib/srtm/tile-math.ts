/**
 * SRTM tile math: coordinate conversions and filename parsing.
 *
 * SRTM 30m tiles cover 1x1 degree each, at 3601x3601 pixels.
 * Naming convention: N/S{lat}E/W{lon}.tif
 * Top-left pixel = (max_lat, min_lon), pixel spacing = 1 arc-second (~30m)
 */

/**
 * Convert lat/lon to SRTM tile filename.
 */
export function latLonToSrtmName(lat: number, lon: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lonDir = lon >= 0 ? "E" : "W";
  const latDeg = Math.floor(Math.abs(lat));
  const lonDeg = Math.floor(Math.abs(lon));
  return `${latDir}${String(latDeg).padStart(2, "0")}${lonDir}${String(lonDeg).padStart(3, "0")}.tif`;
}

/**
 * Parse SRTM filename to geographic bounds.
 * Returns [latMin, lonMin, latMax, lonMax].
 */
export function srtmNameToBounds(name: string): {
  latMin: number;
  lonMin: number;
  latMax: number;
  lonMax: number;
} {
  const latDir = name[0];
  const latDeg = parseInt(name.substring(1, 3));
  const lonDir = name[3];
  const lonDeg = parseInt(name.substring(4, 7));

  return {
    latMin: latDir === "N" ? latDeg : -(latDeg + 1),
    latMax: latDir === "N" ? latDeg + 1 : -latDeg,
    lonMin: lonDir === "E" ? lonDeg : -(lonDeg + 1),
    lonMax: lonDir === "E" ? lonDeg + 1 : -lonDeg,
  };
}

/**
 * Convert lat/lon to pixel coordinates within an SRTM tile.
 * SRTM origin is top-left: row 0 = max lat, col 0 = min lon.
 * Pixel spacing = 1/3600 degree.
 */
export function latLonToPixel(
  lat: number,
  lon: number,
  bounds: { latMin: number; lonMin: number; latMax: number; lonMax: number },
): { row: number; col: number } {
  const row = Math.round((bounds.latMax - lat) * 3600);
  const col = Math.round((lon - bounds.lonMin) * 3600);
  return {
    row: Math.max(0, Math.min(3600, row)),
    col: Math.max(0, Math.min(3600, col)),
  };
}

/**
 * SRTM dataset coverage bounds.
 * SRTM 30m covers latitudes -57 to 60, longitudes -180 to 180.
 * Bounds are slightly wider than strict SRTM spec to avoid edge rejection.
 */
export const SRTM_BOUNDS = {
  latMin: -60,
  latMax: 61,
  lonMin: -181,
  lonMax: 181,
};

/**
 * Check if a lat/lon is within SRTM coverage.
 */
export function isWithinSRTM(lat: number, lon: number): boolean {
  return (
    lat >= SRTM_BOUNDS.latMin && lat <= SRTM_BOUNDS.latMax && lon >= SRTM_BOUNDS.lonMin && lon <= SRTM_BOUNDS.lonMax
  );
}
