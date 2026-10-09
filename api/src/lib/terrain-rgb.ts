/**
 * Mapbox Terrain-RGB v1 PNG encoder — edge-compatible.
 *
 * Terrain-RGB packs height into the pixel's RGB bytes as a base-256 integer
 * with a 10,000 m offset and 0.1 m resolution:
 *
 *   height_m = (R * 256^2 + G * 256 + B) / 10 - 10000
 *
 * The format has no nodata concept: a client decoding any pixel gets a height.
 * We therefore follow Mapbox's own encoder and clamp — values below -10,000 m
 * (deep bathymetry, SRTM nodata) all collapse onto code 0, which decodes as
 * -10,000 m. Clients that need to distinguish nodata must ask for Terrarium
 * (`?format=png` without `encoding=mapbox`), which reserves code 0 for it.
 */

import { encodeRgbPng } from "./rgb-png";

/** Metres added to the height before scaling (Mapbox Terrain-RGB v1). */
export const TERRAIN_RGB_OFFSET_M = 10000;

/** Codes per metre — Terrain-RGB resolves heights to 0.1 m. */
export const TERRAIN_RGB_CODES_PER_M = 10;

/** Largest value three base-256 digits can carry. */
export const TERRAIN_RGB_MAX_CODE = 8388607;

/**
 * Pack a height in metres into a Terrain-RGB integer code.
 *
 * Values are rounded to the format's 0.1 m resolution; anything the format
 * cannot represent (below -10,000 m, above ~828,860.7 m) saturates at the
 * end of the range rather than wrapping into the next digit.
 *
 * @param elevationMeters - Height in metres; NaN is treated as nodata.
 * @returns Code in [0, 8388607] to spread across R, G and B.
 */
export function terrainRgbCode(elevationMeters: number): number {
  // NaN round-trips through clamp without ever matching a bound, so nodata is
  // mapped explicitly onto code 0 (the same pixel as saturated bathymetry).
  if (Number.isNaN(elevationMeters)) return 0;
  const code = Math.round((elevationMeters + TERRAIN_RGB_OFFSET_M) * TERRAIN_RGB_CODES_PER_M);
  return Math.min(Math.max(code, 0), TERRAIN_RGB_MAX_CODE);
}

/**
 * Decode a Terrain-RGB pixel back to metres. Mirrors the arithmetic a client
 * performs, so the round-trip test proves the encoder against the format
 * rather than against itself.
 *
 * @returns Height in metres (multiples of 0.1).
 */
export function decodeTerrainRgb(r: number, g: number, b: number): number {
  return (r * 65536 + g * 256 + b) / TERRAIN_RGB_CODES_PER_M - TERRAIN_RGB_OFFSET_M;
}

/**
 * Encode elevation data as a Mapbox Terrain-RGB v1 PNG.
 *
 * @param data - Elevation values in meters (Int16, NODATA = -32768)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns PNG file as Uint8Array
 */
export function encodeTerrainRgbPNG(data: Int16Array, width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    // bounds: i < width*height and data carries exactly that many values
    const code = terrainRgbCode(data[i]!);
    const off = i * 3;
    rgb[off] = (code >> 16) & 0xff;
    rgb[off + 1] = (code >> 8) & 0xff;
    rgb[off + 2] = code & 0xff;
  }
  return encodeRgbPng(rgb, width, height);
}
