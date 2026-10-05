/**
 * SRTM tile math: coordinate conversions and filename parsing.
 *
 * SRTM 30m tiles cover 1x1 degree each, at 3601x3601 pixels.
 * Naming convention (USGS hgt): the name is the tile's SW corner —
 * N19W156 covers lat [19, 20], lon [-156, -155]. Take floor() of the
 * SIGNED coordinate to find the cell; truncating the absolute value
 * instead selects the cell one degree east/south of the point.
 * Top-left pixel = (max_lat, min_lon), pixel spacing = 1 arc-second (~30m)
 */

/**
 * Convert lat/lon to SRTM tile filename (the cell's SW-corner name).
 */
export function latLonToSrtmName(lat: number, lon: number): string {
  const latCell = Math.floor(lat);
  const lonCell = Math.floor(lon);
  const latDir = latCell >= 0 ? "N" : "S";
  const lonDir = lonCell >= 0 ? "E" : "W";
  return `${latDir}${String(Math.abs(latCell)).padStart(2, "0")}${lonDir}${String(Math.abs(lonCell)).padStart(3, "0")}.tif`;
}

/**
 * Parse SRTM filename to geographic bounds — the exact inverse of
 * {@link latLonToSrtmName} (SW-corner naming).
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
    latMin: latDir === "N" ? latDeg : -latDeg,
    latMax: latDir === "N" ? latDeg + 1 : -latDeg + 1,
    lonMin: lonDir === "E" ? lonDeg : -lonDeg,
    lonMax: lonDir === "E" ? lonDeg + 1 : -lonDeg + 1,
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
