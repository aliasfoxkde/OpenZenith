/**
 * Terrarium PNG encoder — edge-compatible, shared across tile endpoints.
 *
 * Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768
 */

import { zlibSync } from "fflate";

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
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let py = 0; py < height; py++) {
    const rowOff = py * (1 + width * 3);
    raw[rowOff] = 0;
    for (let px = 0; px < width; px++) {
      const elev = data[py * width + px];
      const enc = elev + 32768;
      const pixOff = rowOff + 1 + px * 3;
      raw[pixOff] = (enc >> 8) & 0xff;
      raw[pixOff + 1] = enc & 0xff;
      raw[pixOff + 2] = 0;
    }
  }

  const compressed = zlibSync(raw, { level: 1 });

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdrData[8] = 8;
  ihdrData[9] = 2;

  const ihdr = pngChunk("IHDR", ihdrData);
  const idat = pngChunk("IDAT", compressed);
  const iend = pngChunk("IEND", new Uint8Array(0));

  const result = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  result.set(signature, off);
  off += signature.length;
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
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
