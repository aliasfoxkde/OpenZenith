/**
 * Read elevation from Terrarium PNG tiles stored in R2.
 *
 * Reads the tile directly from the R2 DEM_TILES binding (no HTTP fetch),
 * decodes the Terrarium PNG, and bilinearly interpolates for precise elevation.
 *
 * Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768
 *
 * Pure JS PNG decoder — works in Cloudflare Workers edge runtime.
 */

import { decompressSync } from "fflate";

interface ElevationResult {
  elevation: number | null;
  surface_type: "land" | "ocean" | "unknown";
  unit: string;
  location: { lat: number; lon: number };
  source: string;
  tile: string;
  resolution: number;
}

/**
 * Get tile coordinates for a given lat/lon at a zoom level.
 */
function latLonToTile(
  lat: number,
  lon: number,
  zoom: number,
): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Get elevation at a lat/lon by reading the Terrarium PNG tile directly
 * from R2 and decoding the relevant pixel.
 *
 * Uses zoom 8 tiles (Copernicus GLO-30 + GEBCO 2025, ~1.7km resolution).
 * Falls back through lower zooms if the tile is not available.
 */
export async function getElevationFromR2(
  lat: number,
  lon: number,
): Promise<ElevationResult> {
  const nullResult: ElevationResult = {
    elevation: null,
    surface_type: "unknown",
    unit: "meters",
    location: { lat, lon },
    source: "r2-terrarium",
    tile: "",
    resolution: 1700,
  };

  // Get R2 bucket from env bindings
  const env = process.env as { DEM_TILES?: R2Bucket };
  const bucket = env.DEM_TILES;

  if (!bucket) return nullResult;

  // Try zoom 8 first, then fall back to lower zooms
  for (const zoom of [8, 7, 6, 5]) {
    const { x, y } = latLonToTile(lat, lon, zoom);
    const key = `tiles/${zoom}/${x}/${y}.png`;

    try {
      const object = await bucket.get(key);
      if (!object) continue;

      const buf = await object.arrayBuffer();
      const png = decodePNG(new Uint8Array(buf));
      if (!png) continue;

      const { width, height, pixels } = png;

      // Convert lat/lon to fractional tile coordinates
      const n = 2 ** zoom;
      const xFrac = ((lon + 180) / 360) * n - x;
      const latRad = (lat * Math.PI) / 180;
      const yFrac =
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - y;

      // Bilinear interpolation from the 4 nearest pixels
      const px = xFrac * (width - 1);
      const py = yFrac * (height - 1);

      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);

      const fx = px - x0;
      const fy = py - y0;

      const h00 = decodeTerrariumPixel(pixels, width, x0, y0);
      const h10 = decodeTerrariumPixel(pixels, width, x1, y0);
      const h01 = decodeTerrariumPixel(pixels, width, x0, y1);
      const h11 = decodeTerrariumPixel(pixels, width, x1, y1);

      const elevation =
        h00 * (1 - fx) * (1 - fy) +
        h10 * fx * (1 - fy) +
        h01 * (1 - fx) * fy +
        h11 * fx * fy;

      const resolution = zoom === 8 ? 1700 : zoom === 7 ? 3400 : 6800;

      return {
        elevation: Math.round(elevation * 10) / 10,
        surface_type: elevation < 0 ? "ocean" : "land",
        unit: "meters",
        location: { lat, lon },
        source: "r2-terrarium",
        tile: `${zoom}/${x}/${y}`,
        resolution,
      };
    } catch {
      continue;
    }
  }

  return nullResult;
}

function decodeTerrariumPixel(
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
): number {
  const offset = (y * width + x) * 3;
  return decodeTerrarium(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
}

// ---------------------------------------------------------------------------
// Pure JS PNG decoder (edge-compatible)
// Supports: 8-bit RGB (color type 2) and 8-bit RGBA (color type 6), non-interlaced.
// ---------------------------------------------------------------------------

function decodePNG(data: Uint8Array): { width: number; height: number; pixels: Uint8Array } | null {
  if (
    data[0] !== 137 || data[1] !== 80 || data[2] !== 78 ||
    data[3] !== 71 || data[4] !== 13 || data[5] !== 10 ||
    data[6] !== 26 || data[7] !== 10
  ) {
    return null;
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Uint8Array[] = [];
  let offset = 8;

  while (offset < data.length) {
    const chunkLen = (data[offset] << 24) | (data[offset + 1] << 16) |
                     (data[offset + 2] << 8) | data[offset + 3];
    offset += 4;

    const type = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    offset += 4;

    const chunkData = data.slice(offset, offset + chunkLen);

    if (type === "IHDR") {
      width = (chunkData[0] << 24) | (chunkData[1] << 16) | (chunkData[2] << 8) | chunkData[3];
      height = (chunkData[4] << 24) | (chunkData[5] << 16) | (chunkData[6] << 8) | chunkData[7];
      bitDepth = chunkData[8];
      colorType = chunkData[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return null;
    } else if (type === "IDAT") {
      idatChunks.push(chunkData);
    } else if (type === "IEND") {
      break;
    }

    offset += chunkLen + 4;
  }

  if (width === 0 || height === 0 || idatChunks.length === 0) return null;

  const totalLen = idatChunks.reduce((sum, c) => sum + c.length, 0);
  const compressed = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of idatChunks) {
    compressed.set(chunk, pos);
    pos += chunk.length;
  }

  let raw: Uint8Array;
  try {
    raw = decompressSync(compressed);
  } catch {
    return null;
  }

  const bpp = colorType === 2 ? 3 : 4;
  const stride = width * bpp;
  const pixels = new Uint8Array(width * height * 3);
  const prevRow = new Uint8Array(stride);

  let rawOffset = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset];
    rawOffset++;

    const curRow = raw.slice(rawOffset, rawOffset + stride);
    rawOffset += stride;

    unfilterScanline(filterType, curRow, prevRow, bpp);

    for (let x = 0; x < width; x++) {
      const srcOff = x * bpp;
      const dstOff = (y * width + x) * 3;
      pixels[dstOff] = curRow[srcOff];
      pixels[dstOff + 1] = curRow[srcOff + 1];
      pixels[dstOff + 2] = curRow[srcOff + 2];
    }

    prevRow.set(curRow);
  }

  return { width, height, pixels };
}

function unfilterScanline(
  filterType: number,
  cur: Uint8Array,
  prev: Uint8Array,
  bpp: number,
): void {
  switch (filterType) {
    case 0: break;
    case 1:
      for (let i = bpp; i < cur.length; i++) {
        cur[i] = (cur[i] + cur[i - bpp]) & 0xFF;
      }
      break;
    case 2:
      for (let i = 0; i < cur.length; i++) {
        cur[i] = (cur[i] + prev[i]) & 0xFF;
      }
      break;
    case 3:
      for (let i = 0; i < cur.length; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        const above = prev[i];
        cur[i] = (cur[i] + ((left + above) >> 1)) & 0xFF;
      }
      break;
    case 4:
      for (let i = 0; i < cur.length; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        const above = prev[i];
        const upperLeft = i >= bpp ? prev[i - bpp] : 0;
        cur[i] = (cur[i] + paethPredictor(left, above, upperLeft)) & 0xFF;
      }
      break;
    default: break;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Cloudflare R2 types
declare class R2Bucket {
  get(key: string): Promise<R2Object | null>;
}

interface R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}
