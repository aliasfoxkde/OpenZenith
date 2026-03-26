/**
 * GEBCO 2025 COG reader for bathymetry queries.
 *
 * Reads elevation from GEBCO 2025 quadrant GeoTIFFs using HTTP range requests.
 *
 * GEBCO 2025 quadrants are:
 * - Int16, 21600x21600 pixels (90°x90° at 15-arc-second)
 * - Strip-based (21600 strips of 1 row each)
 * - Uncompressed (strip size = 21600 * 2 = 43,200 bytes)
 * - No explicit NODATA value (Int16 range: -32768 to 32767)
 * - Negative values = below sea level (ocean depth)
 * - Positive values = above sea level (land/ice elevation)
 */

import {
  latLonToQuadName,
  quadNameToBounds,
  latLonToPixel,
} from "./tile-math";

const BYTES_PER_PIXEL = 2; // Int16

// Base URL for GEBCO tile files.
// Production: set GEBCO_TILE_URL env var (e.g., R2 bucket or external server).
// Dev: defaults to localhost:9006 (requires the tile server route).
function getBaseUrl(): string {
  return process.env.GEBCO_TILE_URL || "http://localhost:9006/api/gebco-tile";
}

// Cache parsed TIFF headers to avoid re-fetching
const headerCache = new Map<
  string,
  Promise<TiffHeader | null>
>();

interface TiffHeader {
  stripOffsets: Uint32Array;
  stripBytes: number;
}

/**
 * Parse TIFF header + IFD to extract strip layout.
 * Fetches only the first ~8KB, then the strip offset array.
 */
async function parseTiffHeader(
  url: string,
): Promise<TiffHeader | null> {
  const cached = headerCache.get(url);
  if (cached) return cached;

  const promise = (async () => {
    // Fetch first 8KB for header + IFD entries
    const res = await fetch(url, {
      headers: { Range: "bytes=0-8191" },
    });
    if (res.status !== 206 && res.status !== 200) return null;

    const buf = await res.arrayBuffer();
    const view = new DataView(buf);

    if (buf.byteLength < 8) return null;

    // Little-endian TIFF
    if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x49) return null;
    if (view.getUint16(2, true) !== 42) return null;

    const ifdOffset = view.getUint32(4, true);
    if (ifdOffset + 2 > buf.byteLength) return null;

    const numEntries = view.getUint16(ifdOffset, true);

    let imageWidth = 0;
    let imageHeight = 0;
    let stripOffsetsOffset = 0;
    let stripOffsetsCount = 0;
    let rowsPerStrip = 0;

    for (let i = 0; i < numEntries; i++) {
      const off = ifdOffset + 2 + i * 12;
      if (off + 12 > buf.byteLength) break;

      const tag = view.getUint16(off, true);
      const type = view.getUint16(off + 2, true);
      const count = view.getUint32(off + 4, true);

      // SHORT (type 3) — single value inline
      if (type === 3 && count === 1) {
        const v = view.getUint16(off + 8, true);
        if (tag === 256) imageWidth = v;
        if (tag === 257) imageHeight = v;
        if (tag === 278) rowsPerStrip = v;
      }
      // LONG (type 4) — single value inline
      else if (type === 4 && count === 1) {
        const v = view.getUint32(off + 8, true);
        if (tag === 256) imageWidth = v;
        if (tag === 257) imageHeight = v;
        if (tag === 278) rowsPerStrip = v;
      }
      // LONG array (type 4, count > 1) — offset to data
      else if (type === 4 && count > 1) {
        const arrOffset = view.getUint32(off + 8, true);
        if (tag === 273) {
          stripOffsetsOffset = arrOffset;
          stripOffsetsCount = count;
        }
      }
    }

    if (stripOffsetsCount === 0) return null;
    if (imageWidth === 0 || imageHeight === 0) return null;
    if (rowsPerStrip === 0) rowsPerStrip = imageHeight;

    const numStrips = Math.ceil(imageHeight / rowsPerStrip);
    const stripBytes = imageWidth * BYTES_PER_PIXEL;
    const arraysEnd = stripOffsetsOffset + numStrips * 4;

    let offsets: Uint32Array;

    if (arraysEnd <= buf.byteLength) {
      offsets = new Uint32Array(numStrips);
      for (let i = 0; i < numStrips; i++) {
        offsets[i] = view.getUint32(stripOffsetsOffset + i * 4, true);
      }
    } else {
      // Fetch the full strip offset array
      const res2 = await fetch(url, {
        headers: { Range: `bytes=0-${arraysEnd - 1}` },
      });
      if (res2.status !== 206 && res2.status !== 200) return null;
      const buf2 = await res2.arrayBuffer();
      const view2 = new DataView(buf2);

      offsets = new Uint32Array(numStrips);
      for (let i = 0; i < numStrips; i++) {
        offsets[i] = view2.getUint32(stripOffsetsOffset + i * 4, true);
      }
    }

    const header: TiffHeader = { stripOffsets: offsets, stripBytes };

    // Cache for 5 minutes
    headerCache.set(url, Promise.resolve(header));
    setTimeout(() => headerCache.delete(url), 300_000);

    return header;
  })();

  headerCache.set(url, promise);
  return promise;
}

/**
 * Look up elevation from a GEBCO 2025 quadrant file.
 * Returns negative values for ocean depth, positive for land/ice elevation.
 *
 * Optimization: Only fetches 2 HTTP requests:
 *   1. Header (~8KB or ~87KB for strip offsets) — cached for 5 min
 *   2. Single strip (~43KB) containing the target pixel
 */
export async function getGebcoElevation(
  lat: number,
  lon: number,
): Promise<{
  elevation: number | null;
  surface_type: "land" | "ocean" | "unknown";
  unit: string;
  location: { lat: number; lon: number };
  source: string;
  tile: string;
  resolution: number;
}> {
  const nullResult = {
    elevation: null as number | null,
    surface_type: "unknown" as const,
    unit: "meters",
    location: { lat, lon },
    source: "gebco2025" as string,
    tile: "" as string,
    resolution: 450,
  };

  const quadName = latLonToQuadName(lat, lon);
  const bounds = quadNameToBounds(quadName);
  if (!bounds) return { ...nullResult, tile: quadName };

  const { row, col } = latLonToPixel(lat, lon, bounds);
  const url = `${getBaseUrl()}/${quadName}`;

  // Parse TIFF header (cached)
  const header = await parseTiffHeader(url);
  if (!header) return { ...nullResult, tile: quadName };

  if (row >= header.stripOffsets.length) return { ...nullResult, tile: quadName };

  const stripOffset = header.stripOffsets[row];
  const stripBytes = header.stripBytes;

  // Fetch just the single strip containing our target pixel
  const res = await fetch(url, {
    headers: {
      Range: `bytes=${stripOffset}-${stripOffset + stripBytes - 1}`,
    },
  });
  if (res.status !== 206 && res.status !== 200) return { ...nullResult, tile: quadName };

  const stripData = new Uint8Array(await res.arrayBuffer());

  // Decode Int16 value at the target column (little-endian)
  const byteOffset = col * BYTES_PER_PIXEL;
  if (byteOffset + BYTES_PER_PIXEL > stripData.length) return { ...nullResult, tile: quadName };

  const lowByte = stripData[byteOffset];
  const highByte = stripData[byteOffset + 1];
  const value = (highByte << 8) | lowByte;

  // Convert to signed Int16
  const signedValue = value >= 32768 ? value - 65536 : value;

  // GEBCO nodata detection — no explicit nodata, but unrealistic values
  if (signedValue > 8850 || signedValue < -11000) {
    return { ...nullResult, tile: quadName };
  }

  const elevation = signedValue;
  const surfaceType = signedValue < 0 ? "ocean" : "land";

  return {
    elevation,
    surface_type: surfaceType,
    unit: "meters",
    location: { lat, lon },
    source: "gebco2025",
    tile: quadName,
    resolution: 450,
  };
}
