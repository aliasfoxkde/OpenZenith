/**
 * Terrarium PNG encoder — edge-compatible, shared across tile endpoints.
 *
 * Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768
 */

import { encodeRgbPng } from "./rgb-png";

/**
 * Encode elevation data as a Terrarium PNG image.
 *
 * Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768
 * Produces a valid PNG buffer (no external PNG library needed).
 *
 * @param data - Elevation values in meters (Int16, NODATA = -32768)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns PNG file as Uint8Array
 */
export function encodeTerrariumPNG(data: Int16Array, width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const enc = data[i] + 32768;
    const off = i * 3;
    rgb[off] = (enc >> 8) & 0xff;
    rgb[off + 1] = enc & 0xff;
    rgb[off + 2] = 0;
  }
  return encodeRgbPng(rgb, width, height);
}
