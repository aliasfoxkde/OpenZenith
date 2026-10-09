/**
 * Minimal 8-bit RGB PNG writer shared by the elevation tile encoders.
 *
 * Both encoders (Terrarium, Terrain-RGB) pack one height value into each
 * pixel's R/G/B bytes, so the only difference between them is the byte math.
 * Keeping the container here means a single place owns the IHDR/IDAT/IEND
 * layout, the CRC table and the zlib level — and guarantees the two formats
 * stay byte-for-byte comparable.
 */

import { zlibSync } from "fflate";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Wrap `rgb` (RGB triples, row-major, `width * height * 3` bytes) in a PNG.
 *
 * @param rgb - Pixel bytes, 3 per pixel, no filter bytes.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns PNG file as Uint8Array
 */
export function encodeRgbPng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  // One filter byte (0 = None) per scanline, as PNG requires.
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let py = 0; py < height; py++) {
    const rowOff = py * (1 + width * 3);
    raw[rowOff] = 0;
    for (let px = 0; px < width; px++) {
      const srcOff = (py * width + px) * 3;
      const dstOff = rowOff + 1 + px * 3;
      // bounds: rgb is width*height*3 bytes and srcOff/srcOff+2 stay inside it
      raw[dstOff] = rgb[srcOff]!;
      raw[dstOff + 1] = rgb[srcOff + 1]!;
      raw[dstOff + 2] = rgb[srcOff + 2]!;
    }
  }
  return assembleRgbPng(raw, width, height);
}

/**
 * Compress and containerize an already-filtered raw scanline buffer into a
 * PNG. `raw` must be `height` scanlines of `1 + width * 3` bytes (filter byte
 * 0 + RGB triples), exactly as `encodeRgbPng` builds internally. This is the
 * shared tail of every elevation PNG encoder in the repo (cycle V, C2): the
 * elevation-accuracy and elevation-color routes own only their pixel-fill
 * loops; the container layout, zlib level and CRC live here alone.
 *
 * @param raw - Filtered scanline buffer (see above).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns PNG file as Uint8Array
 */
export function assembleRgbPng(raw: Uint8Array, width: number, height: number): Uint8Array {
  // Level 1: the elevation grids are near-random bytes, so higher levels buy
  // ~nothing while costing real edge CPU on every cache miss.
  const compressed = zlibSync(raw, { level: 1 });

  // IHDR: bit depth 8, colour type 2 (truecolour), no interlace — the other
  // three fields are zero and stay zero.
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdrData[8] = 8;
  ihdrData[9] = 2;

  const ihdr = pngChunk("IHDR", ihdrData);
  const idat = pngChunk("IDAT", compressed);
  const iend = pngChunk("IEND", new Uint8Array(0));

  const result = new Uint8Array(PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  result.set(PNG_SIGNATURE, off);
  off += PNG_SIGNATURE.length;
  result.set(ihdr, off);
  off += ihdr.length;
  result.set(idat, off);
  off += idat.length;
  result.set(iend, off);
  return result;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);

  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(crcInput));
  return chunk;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
