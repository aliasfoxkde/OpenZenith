/**
 * Globe GIS Tools — Measurement and coordinate utilities.
 *
 * Provides distance measurement, area calculation, and coordinate
 * conversion functions for use with CesiumJS entities.
 */

/** Haversine distance between two points (meters) */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Format distance in human-readable units */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters.toFixed(0)} m`;
  if (meters < 100000) return `${(meters / 1000).toFixed(2)} km`;
  return `${(meters / 1000).toFixed(0)} km`;
}

/** Format area in human-readable units */
export function formatArea(sqMeters: number): string {
  if (sqMeters < 10000) return `${sqMeters.toFixed(0)} m²`;
  if (sqMeters < 1000000) return `${(sqMeters / 10000).toFixed(2)} ha`;
  return `${(sqMeters / 1000000).toFixed(2)} km²`;
}

/**
 * Calculate area of a polygon using the shoelace formula (sq meters).
 * Input: array of [lon, lat] pairs.
 */
export function polygonArea(coords: number[][]): number {
  if (coords.length < 3) return 0;
  const R = 6371000;
  const rad = Math.PI / 180;
  let area = 0;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i][0] * rad;
    const yi = coords[i][1] * rad;
    const xj = coords[j][0] * rad;
    const yj = coords[j][1] * rad;
    area += (xj - xi) * (2 + Math.sin(yi) + Math.sin(yj));
  }
  area = Math.abs((area * R * R) / 2);
  return area;
}

/**
 * Calculate total length of a polyline (meters).
 * Input: array of [lon, lat] pairs.
 */
export function polylineLength(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineDistance(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return total;
}

// ─── Coordinate Conversion ───

/** Decimal degrees to DMS string */
export function toDMS(lat: number, lon: number): string {
  const fmt = (d: number, pos: string, neg: string) => {
    const dir = d >= 0 ? pos : neg;
    const a = Math.abs(d);
    const deg = Math.floor(a);
    const min = Math.floor((a - deg) * 60);
    const sec = ((a - deg - min / 60) * 3600).toFixed(2);
    return `${deg}°${min}'${sec}"${dir}`;
  };
  return `${fmt(lat, "N", "S")} ${fmt(lon, "E", "W")}`;
}

/** Decimal degrees to UTM string (approximate, no zone letter) */
export function toUTM(lat: number, lon: number): string {
  const zone = Math.floor((lon + 180) / 6) + 1;
  // Approximate easting and northing
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = ep2 * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lon0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latRad) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latRad));
  const easting =
    500000 + N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120);
  const northing =
    M +
    N *
      Math.tan(latRad) *
      (A ** 2 / 2 +
        ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
        ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720);
  return `${zone}${lat >= 0 ? "N" : "S"} ${easting.toFixed(0)}E ${northing.toFixed(0)}N`;
}

/** Decimal degrees to MGRS string (simplified, 10-digit precision) */
export function toMGRS(lat: number, lon: number): string {
  // Simplified MGRS — full implementation requires a dedicated library
  const zone = Math.floor((lon + 180) / 6) + 1;
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const col = Math.floor((lon + 180) / 6);
  const row = Math.floor((lat + 80) / 8);
  const sqLetter1 = letters[(col * 8 + (row % 8)) % 24] || "X";
  const sqLetter2 = letters[(row * 2 + col) % 24] || "X";
  const east100k = Math.floor((((lon + 180) % 6) + 0.5) / 1) * 100000;
  const north100k = Math.floor((((lat + 80) % 8) + 0.5) / 1) * 100000;
  const e5 = Math.floor(((lon + 180) % 1) * 100000) % 100000;
  const n5 = Math.floor(((lat + 80) % 1) * 100000) % 100000;
  return `${String(zone).padStart(2, "0")}${sqLetter1}${sqLetter2} ${String(east100k + e5).padStart(5, "0")} ${String(north100k + n5).padStart(5, "0")}`;
}

/** Get all coordinate format representations for a point */
export function getAllFormats(lat: number, lon: number): Record<string, string> {
  return {
    DD: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
    DMS: toDMS(lat, lon),
    DDM: (() => {
      const fmt = (d: number, pos: string, neg: string) => {
        const dir = d >= 0 ? pos : neg;
        const a = Math.abs(d);
        const deg = Math.floor(a);
        const min = ((a - deg) * 60).toFixed(3);
        return `${deg}°${min}'${dir}`;
      };
      return `${fmt(lat, "N", "S")} ${fmt(lon, "E", "W")}`;
    })(),
    UTM: toUTM(lat, lon),
    MGRS: toMGRS(lat, lon),
  };
}
