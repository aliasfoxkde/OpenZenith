/**
 * Slippy map tile math: z/x/y ↔ lat/lon conversions.
 *
 * Standard OSM/MapLibre tile scheme:
 * - z = zoom level (0-18)
 * - x = column (0 to 2^z - 1)
 * - y = row (0 to 2^z - 1)
 * - Tiles are 256x256 pixels
 */

/**
 * Convert slippy tile coordinates to lat/lon bounds.
 * Returns {north, south, east, west} in degrees.
 */
export function tileToLatLon(
  z: number,
  x: number,
  y: number,
): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  const north = (180 / Math.PI) * Math.atan(Math.sinh(n));
  const south = tileToLatLon_South(z, y);
  const west = (x / Math.pow(2, z)) * 360 - 180;
  const east = ((x + 1) / Math.pow(2, z)) * 360 - 180;
  return { north, south, east, west };
}

function tileToLatLon_South(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 1)) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/**
 * Convert lat/lon to slippy tile coordinates at a given zoom level.
 */
export function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z));
  return { x, y };
}

/**
 * Convert slippy tile coordinates to a WMS bbox string ("west,south,east,north").
 */
export function tileToBboxString(z: number, x: number, y: number): string {
  const { west, south, east, north } = tileToLatLon(z, x, y);
  return `${west},${south},${east},${north}`;
}

/**
 * Compute the number of SRTM pixels per slippy map tile pixel
 * at a given zoom level. SRTM is ~30m (1 arc-second) resolution.
 */
export function srtmPixelsPerTilePixel(z: number): number {
  // At zoom z, each tile pixel covers 360/(2^z * 256) degrees
  // SRTM pixel spacing = 1/3600 degrees
  // So SRTM pixels per tile pixel = (360/(2^z * 256)) / (1/3600)
  //                             = 360 * 3600 / (256 * 2^z)
  //                             = 5062.5 / 2^z
  return 5062.5 / Math.pow(2, z);
}

/**
 * Determine if we need to resample SRTM data for a given zoom level.
 * - Zoom 10-12: ~1-5 SRTM pixels per tile pixel (near-native)
 * - Zoom 13+: sub-pixel (need interpolation from nearest tile)
 * - Zoom 0-9: many SRTM pixels per tile pixel (downsample)
 */
export function getResampleMode(z: number): "downsample" | "native" | "interpolate" {
  const ratio = srtmPixelsPerTilePixel(z);
  if (ratio > 2) return "downsample";
  if (ratio >= 0.5) return "native";
  return "interpolate";
}
