/**
 * Tile assembler: produces 256x256 elevation grids for slippy map tiles.
 *
 * For a given z/x/y tile:
 * 1. Compute lat/lon bounds
 * 2. Find which SRTM 1° tiles overlap
 * 3. Fetch pre-extracted 256x256 chunks
 * 4. Sample/interpolate to produce a 256x256 Int16Array
 */

import { unzlibSync } from "fflate";
import { latLonToSrtmName, srtmNameToBounds, latLonToPixel, isWithinSRTM, SRTM_BOUNDS } from "./srtm/tile-math";
import { tileToLatLon } from "./srtm/zoom-math";
import type { ChunkBackend } from "./storage/backend";
import { cacheGet, cachePut } from "./storage/cache";

const TILE_SIZE = 256;
const NODATA = -32768;

// Known corrupted SRTM chunks in HuggingFace (aliasfox/srtm30m-merged).
// These tiles have valid-looking but wildly incorrect elevation values.
// Skip them during assembly so AWS fallback provides correct data.
const BLACKLISTED_SRTM_TILES = new Set([
  "N36W116", // Death Valley: reports 1668m instead of -85m
  "S03E037", // Kilimanjaro: reports 1352m instead of 5895m
  "S32W070", // Aconcagua: reports 2153m instead of 6961m
  "N19W155", // Hawaii: reports 0m instead of 4205m
]);

// AWS Terrain Tiles — same SRTM 30m data as pre-built Terrarium PNG
const AWS_TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export interface TileResult {
  data: Int16Array;
  width: number;
  height: number;
  zoom: number;
}

/**
 * Get elevation tile data for a slippy map tile.
 * Returns a 256x256 Int16Array of elevation values in meters.
 * NoData values are set to -32768.
 */
export async function getTileData(z: number, x: number, y: number, storage: ChunkBackend): Promise<TileResult> {
  const bounds = tileToLatLon(z, x, y);

  // At low zoom (z0-z6), HuggingFace chunk assembly is unreliable
  // (too many 1° SRTM tiles needed → timeout). Use AWS directly.
  if (z <= 6) {
    const awsData = await fetchAWSTerrainTile(z, x, y);
    if (awsData) {
      return { data: awsData, width: TILE_SIZE, height: TILE_SIZE, zoom: z };
    }
    // If AWS also fails, fall through to HuggingFace
  }

  // Check if any part of this tile overlaps SRTM coverage
  const outsideSRTM =
    bounds.south > SRTM_BOUNDS.latMax ||
    bounds.north < SRTM_BOUNDS.latMin ||
    bounds.west > SRTM_BOUNDS.lonMax ||
    bounds.east < SRTM_BOUNDS.lonMin;

  if (outsideSRTM) {
    // Outside SRTM — try AWS (which includes GEBCO bathymetry)
    const awsData = await fetchAWSTerrainTile(z, x, y);
    if (awsData) {
      return { data: awsData, width: TILE_SIZE, height: TILE_SIZE, zoom: z };
    }
    return {
      data: new Int16Array(TILE_SIZE * TILE_SIZE).fill(NODATA),
      width: TILE_SIZE,
      height: TILE_SIZE,
      zoom: z,
    };
  }

  // Find all SRTM tiles that overlap
  const srtmTiles = findOverlappingSrtmTiles(bounds);
  const data = new Int16Array(TILE_SIZE * TILE_SIZE).fill(NODATA);

  // Check if any overlapping SRTM tile is blacklisted (corrupted data)
  const hasBlacklisted = srtmTiles.some((t) => BLACKLISTED_SRTM_TILES.has(t));

  // Process each SRTM tile (skip blacklisted ones)
  for (const srtmName of srtmTiles) {
    if (BLACKLISTED_SRTM_TILES.has(srtmName)) continue;
    try {
      await fillTileFromSrtm(data, srtmName, bounds, storage);
    } catch {
      // Skip tiles that fail (not all 1° tiles have data)
    }
  }

  // Check if HuggingFace assembly produced useful data
  // At low zoom, many chunks fail silently → all-NODATA or mostly-NODATA
  let validCount = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== NODATA) validCount++;
  }

  // If less than 5% valid, OR any blacklisted tile overlaps, try AWS fallback
  const validPct = validCount / data.length;
  const needsFallback = validPct < 0.05 || validCount === 0 || hasBlacklisted;

  if (needsFallback) {
    console.log(`[tile] HuggingFace sparse for ${z}/${x}/${y} (${(validPct * 100).toFixed(1)}% valid), trying AWS`);
    const awsData = await fetchAWSTerrainTile(z, x, y);
    if (awsData) {
      // If AWS has more valid data, use it
      let awsValid = 0;
      for (let i = 0; i < awsData.length; i++) {
        if (awsData[i] !== NODATA) awsValid++;
      }
      if (awsValid > validCount) {
        console.log(`[tile] AWS fallback better (${awsValid} vs ${validCount} valid) for ${z}/${x}/${y}`);
        return { data: awsData, width: TILE_SIZE, height: TILE_SIZE, zoom: z };
      }
    }
    console.log(`[tile] AWS fallback not better for ${z}/${x}/${y}`);
  }

  return { data, width: TILE_SIZE, height: TILE_SIZE, zoom: z };
}

/**
 * Find all SRTM tile names that overlap with the given bounds.
 */
function findOverlappingSrtmTiles(bounds: { north: number; south: number; east: number; west: number }): string[] {
  const tiles: Set<string> = new Set();

  const lats = [bounds.north - 0.001, (bounds.north + bounds.south) / 2, bounds.south + 0.001];
  const lons = [bounds.west + 0.001, (bounds.west + bounds.east) / 2, bounds.east - 0.001];

  for (const lat of lats) {
    for (const lon of lons) {
      if (isWithinSRTM(lat, lon)) {
        tiles.add(latLonToSrtmName(lat, lon));
      }
    }
  }

  return Array.from(tiles);
}

/**
 * Fill the output tile array with elevation data from one SRTM tile.
 * Fetches pre-extracted chunks and samples pixels to the output grid.
 */
async function fillTileFromSrtm(
  output: Int16Array,
  srtmName: string,
  tileBounds: { north: number; south: number; east: number; west: number },
  storage: ChunkBackend,
): Promise<void> {
  const srtmBounds = srtmNameToBounds(srtmName);

  // Find the overlap region
  const overlapNorth = Math.min(tileBounds.north, srtmBounds.latMax);
  const overlapSouth = Math.max(tileBounds.south, srtmBounds.latMin);
  const overlapWest = Math.max(tileBounds.west, srtmBounds.lonMin);
  const overlapEast = Math.min(tileBounds.east, srtmBounds.lonMax);

  if (overlapNorth <= overlapSouth || overlapWest >= overlapEast) return;

  // Convert overlap bounds to SRTM pixel range
  const startPixel = latLonToPixel(overlapNorth, overlapWest, srtmBounds);
  const endPixel = latLonToPixel(overlapSouth, overlapEast, srtmBounds);

  // Determine which chunks we need
  const startChunkRow = Math.floor(startPixel.row / 256);
  const startChunkCol = Math.floor(startPixel.col / 256);
  const endChunkRow = Math.floor(endPixel.row / 256);
  const endChunkCol = Math.floor(endPixel.col / 256);

  // Fetch and decompress needed chunks
  const chunkCache = new Map<
    string,
    { data: Int16Array; width: number; height: number; chunkRow: number; chunkCol: number }
  >();

  for (let cr = startChunkRow; cr <= endChunkRow; cr++) {
    for (let cc = startChunkCol; cc <= endChunkCol; cc++) {
      const cacheKey = `${cr}:${cc}`;
      if (chunkCache.has(cacheKey)) continue;

      const chunkKey = `oz:chunk:${srtmName}:${cr}:${cc}`;
      let compressedData = await cacheGet(chunkKey);
      if (!compressedData) {
        compressedData = await storage.fetchChunk(srtmName, cr, cc);
        await cachePut(chunkKey, compressedData);
      }

      // Decompress
      const rawBytes = unzlibSync(new Uint8Array(compressedData));

      // Compute chunk dimensions (edge tiles may be smaller)
      const chunkWidth = cc < 14 ? 256 : 3601 - 14 * 256;
      const chunkHeight = cr < 14 ? 256 : 3601 - 14 * 256;
      const pixels = chunkWidth * chunkHeight;

      // Undo TIFF horizontal predictor (predictor=2).
      // SRTM GeoTIFF tiles store horizontal differences; undo by cumulative sum per row.
      const rawData = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, pixels);
      const data = new Int16Array(pixels);
      for (let r = 0; r < chunkHeight; r++) {
        const rowOff = r * chunkWidth;
        data[rowOff] = rawData[rowOff]; // first pixel is the absolute value
        for (let c = 1; c < chunkWidth; c++) {
          data[rowOff + c] = data[rowOff + c - 1] + rawData[rowOff + c];
        }
      }

      chunkCache.set(cacheKey, { data, width: chunkWidth, height: chunkHeight, chunkRow: cr, chunkCol: cc });
    }
  }

  // Sample SRTM pixels and map to output grid
  const latStep = (tileBounds.north - tileBounds.south) / TILE_SIZE;
  const lonStep = (tileBounds.east - tileBounds.west) / TILE_SIZE;

  for (let py = 0; py < TILE_SIZE; py++) {
    const lat = tileBounds.north - (py + 0.5) * latStep;
    if (lat > srtmBounds.latMax || lat < srtmBounds.latMin) continue;

    for (let px = 0; px < TILE_SIZE; px++) {
      const lon = tileBounds.west + (px + 0.5) * lonStep;
      if (lon < srtmBounds.lonMin || lon > srtmBounds.lonMax) continue;

      const pixel = latLonToPixel(lat, lon, srtmBounds);
      const chunkRow = Math.floor(pixel.row / 256);
      const chunkCol = Math.floor(pixel.col / 256);

      const chunk = chunkCache.get(`${chunkRow}:${chunkCol}`);
      if (!chunk) continue;

      const localRow = pixel.row - chunkRow * 256;
      const localCol = pixel.col - chunkCol * 256;

      if (localRow < chunk.height && localCol < chunk.width) {
        const val = chunk.data[localRow * chunk.width + localCol];
        if (val !== NODATA) {
          output[py * TILE_SIZE + px] = val;
        }
      }
    }
  }
}

/**
 * Fetch and decode a Terrarium PNG tile from AWS Terrain Tiles.
 *
 * AWS hosts the same SRTM 30m data as pre-built Terrarium PNG tiles at all
 * zoom levels (z0-z15). This is our fallback when HuggingFace chunk assembly
 * fails (typically at z0-z7 due to too many chunk fetches).
 *
 * AWS tile size is 256x256 (z0-z12) which matches our TILE_SIZE.
 *
 * @returns Decoded elevation Int16Array, or null on failure
 */
async function fetchAWSTerrainTile(z: number, x: number, y: number): Promise<Int16Array | null> {
  try {
    const url = AWS_TERRAIN_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
    console.log(`[tile] Fetching AWS: ${url}`);

    const resp = await fetch(url);
    console.log(
      `[tile] AWS response: ${resp.status} ${resp.headers.get("content-type")} ${resp.headers.get("content-length")}`,
    );
    if (!resp.ok) return null;

    const buf = await resp.arrayBuffer();
    console.log(`[tile] AWS body received: ${buf.byteLength} bytes`);

    const decoded = await decodeTerrariumPNG(new Uint8Array(buf));
    console.log(`[tile] AWS decode result: ${decoded ? "OK (" + decoded.length + " pixels)" : "null"}`);
    return decoded;
  } catch (err) {
    console.log(`[tile] AWS fetch error: ${err}`);
    return null;
  }
}

/**
 * Decode a Terrarium PNG to elevation Int16Array.
 *
 * Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768
 * PNG format: 8-bit RGB, no alpha, zlib-compressed IDAT chunks.
 *
 * @param png - Raw PNG file bytes
 * @returns 256x256 Int16Array of elevation values
 */
async function decodeTerrariumPNG(png: Uint8Array): Promise<Int16Array | null> {
  try {
    let offset = 8; // Skip PNG signature

    const idatChunks: Uint8Array[] = [];
    let width = 0;
    let height = 0;
    let colorType = 0;

    while (offset < png.length) {
      const chunkLen = (png[offset] << 24) | (png[offset + 1] << 16) | (png[offset + 2] << 8) | png[offset + 3];
      const chunkType = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
      const chunkData = png.subarray(offset + 8, offset + 8 + chunkLen);

      if (chunkType === "IHDR") {
        width = (chunkData[0] << 24) | (chunkData[1] << 16) | (chunkData[2] << 8) | chunkData[3];
        height = (chunkData[4] << 24) | (chunkData[5] << 16) | (chunkData[6] << 8) | chunkData[7];
        colorType = chunkData[9];
      } else if (chunkType === "IDAT") {
        idatChunks.push(chunkData);
      }

      offset += 12 + chunkLen; // 4 (len) + 4 (type) + data + 4 (crc)
    }

    if (width === 0 || height === 0 || idatChunks.length === 0) return null;

    // Concatenate IDAT chunks and decompress
    const totalLen = idatChunks.reduce((sum, c) => sum + c.length, 0);
    const compressed = new Uint8Array(totalLen);
    let off = 0;
    for (const chunk of idatChunks) {
      compressed.set(chunk, off);
      off += chunk.length;
    }

    const raw = await inflateDecompress(compressed);

    // Bytes per pixel (RGB=3, RGBA=4, Grayscale=1)
    const bpp = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 3;
    const bytesPerRow = 1 + width * bpp; // +1 for PNG filter byte

    // PNG row filter reconstruction
    // Filter types: 0=None, 1=Sub, 2=Up, 3=Average, 4=Paeth
    const stride = width * bpp;
    const prevRow = new Uint8Array(stride);
    const currRow = new Uint8Array(stride);
    const data = new Int16Array(width * height);

    for (let py = 0; py < height; py++) {
      const rowStart = py * bytesPerRow;
      const filterType = raw[rowStart];
      const rowData = raw.subarray(rowStart + 1, rowStart + 1 + stride);

      switch (filterType) {
        case 0: // None
          currRow.set(rowData);
          break;
        case 1: // Sub
          for (let i = 0; i < stride; i++) {
            currRow[i] = (rowData[i] + (i >= bpp ? currRow[i - bpp] : 0)) & 0xff;
          }
          break;
        case 2: // Up
          for (let i = 0; i < stride; i++) {
            currRow[i] = (rowData[i] + prevRow[i]) & 0xff;
          }
          break;
        case 3: // Average
          for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? currRow[i - bpp] : 0;
            const b = prevRow[i];
            currRow[i] = (rowData[i] + ((a + b) >> 1)) & 0xff;
          }
          break;
        case 4: // Paeth
          for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? currRow[i - bpp] : 0;
            const b = prevRow[i];
            const c = i >= bpp ? prevRow[i - bpp] : 0;
            currRow[i] = (rowData[i] + paethPredictor(a, b, c)) & 0xff;
          }
          break;
        default:
          currRow.set(rowData);
          break;
      }

      // Copy current row to prevRow for next iteration
      prevRow.set(currRow);

      // Decode Terrarium from unfiltered row
      for (let px = 0; px < width; px++) {
        const i = px * bpp;
        const r = currRow[i];
        const g = currRow[i + 1];
        const b = currRow[i + 2];
        const elev = r * 256 + g + b / 256 - 32768;
        data[py * width + px] = r === 0 && g === 0 && b === 0 ? NODATA : Math.round(elev);
      }
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Inflate zlib-compressed data using DecompressionStream.
 * fflate's inflateSync fails on some zlib streams ("invalid block type"),
 * but the browser's native DecompressionStream handles them correctly.
 */
async function inflateDecompress(data: Uint8Array): Promise<Uint8Array> {
  // Try DecompressionStream first (handles all zlib formats)
  if (typeof DecompressionStream !== "undefined") {
    try {
      const ds = new DecompressionStream("deflate");
      const writer = ds.writable.getWriter();
      writer.write(data as unknown as BufferSource);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      const result = new Uint8Array(totalLen);
      let off = 0;
      for (const c of chunks) {
        result.set(c, off);
        off += c.length;
      }
      return result;
    } catch {
      // Fall through to fflate
    }
  }

  // Fallback: fflate inflateSync (may fail on some zlib streams)
  const { inflateSync } = await import("fflate");
  return inflateSync(data);
}

/**
 * Paeth predictor for PNG filter type 4.
 */
function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
