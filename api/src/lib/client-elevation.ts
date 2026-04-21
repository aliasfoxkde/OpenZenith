/**
 * Client-side elevation module — CSR-first terrain/elevation.
 *
 * Fetches SRTM chunks directly from HuggingFace, decompresses in the browser,
 * and provides point/batch/tile APIs with shared caching.
 *
 * Falls back to server endpoints (/api/elevation, /api/dem-tile) when
 * HuggingFace is unreachable (CORS blocked, offline, etc.).
 *
 * No Node.js dependencies — pure browser JS + fflate.
 */

import { unzlibSync } from "fflate";
import { latLonToSrtmName, srtmNameToBounds, latLonToPixel, isWithinSRTM } from "./srtm/tile-math";
import { tileToLatLon } from "./srtm/zoom-math";
import {
  parseMergedHeader,
  extractChunkFromMerged,
  getLatDir,
  getTileBase,
  type MergedIndex,
} from "./srtm/merged-parser";
import { latLonToQuadName, quadNameToBounds, latLonToPixel as gebcoLatLonToPixel } from "./gebco/tile-math";

// --- Types ---

interface DecodedChunk {
  data: Int16Array;
  width: number;
  height: number;
}

// --- GEBCO 2025 client-side constants ---

const GEBCO_CEDA_BASE = "https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/ice_surface_elevation/geotiff";
const GEBCO_STRIP_DATA_START = 135948;
const GEBCO_STRIP_BYTES = 21600 * 2; // 43,200 bytes per row (Int16)
const gebcoStripCache = new Map<string, { strip: Uint8Array; ts: number }>();

// --- HuggingFace URL -- same pattern as server backend ---

const HF_REPO = "aliasfox/srtm30m-merged";

function buildHfUrl(path: string): string {
  return `https://huggingface.co/datasets/${HF_REPO}/resolve/main/${path}`;
}

// --- Caches ---

const MAX_CACHE_SIZE = 64;
const chunkCache = new Map<string, { entry: DecodedChunk; ts: number }>();
const mergedCache = new Map<string, { data: Uint8Array; index: MergedIndex; ts: number }>();
const CHUNK_TTL = 10 * 60 * 1000;
const MERGED_TTL = 30 * 60 * 1000;

function cacheEvict(cache: Map<string, { ts: number }>) {
  if (cache.size <= MAX_CACHE_SIZE) return;
  let oldest = Infinity;
  let oldestKey = "";
  for (const [key, val] of cache) {
    if (val.ts < oldest) {
      oldest = val.ts;
      oldestKey = key;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

// --- Fetch merged file from HuggingFace ---

async function fetchMergedFile(srtmName: string): Promise<{ data: Uint8Array; index: MergedIndex } | null> {
  const cached = mergedCache.get(srtmName);
  if (cached && Date.now() - cached.ts < MERGED_TTL) return cached;

  const latDir = getLatDir(srtmName);
  const base = getTileBase(srtmName);
  const url = buildHfUrl(`${latDir}/${base}.merged`);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const data = new Uint8Array(buffer);
    const index = parseMergedHeader(data);
    if (!index) return null;

    cacheEvict(mergedCache);
    const entry = { data, index, ts: Date.now() };
    mergedCache.set(srtmName, entry);
    return entry;
  } catch {
    return null;
  }
}

// --- Fetch and decode a single chunk ---

async function getDecodedChunk(srtmName: string, chunkRow: number, chunkCol: number): Promise<DecodedChunk | null> {
  const cacheKey = `${srtmName}:${chunkRow}:${chunkCol}`;
  const cached = chunkCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHUNK_TTL) return cached.entry;

  // Try merged file
  const merged = await fetchMergedFile(srtmName);
  if (merged) {
    const rawChunk = extractChunkFromMerged(merged.data, merged.index, chunkRow, chunkCol);
    const decoded = decodeChunk(rawChunk, chunkRow, chunkCol);
    if (decoded) {
      cacheEvict(chunkCache);
      chunkCache.set(cacheKey, { entry: decoded, ts: Date.now() });
      return decoded;
    }
  }

  return null;
}

// --- Decode a raw deflate chunk to Int16Array ---

function decodeChunk(rawChunk: Uint8Array, chunkRow: number, chunkCol: number): DecodedChunk | null {
  try {
    const rawBytes = unzlibSync(rawChunk);
    const chunkWidth = chunkCol < 14 ? 256 : 3601 - 14 * 256;
    const chunkHeight = chunkRow < 14 ? 256 : 3601 - 14 * 256;
    const pixels = chunkWidth * chunkHeight;

    const rawData = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, pixels);
    const data = new Int16Array(pixels);
    for (let r = 0; r < chunkHeight; r++) {
      const rowOff = r * chunkWidth;
      data[rowOff] = rawData[rowOff];
      for (let c = 1; c < chunkWidth; c++) {
        data[rowOff + c] = data[rowOff + c - 1] + rawData[rowOff + c];
      }
    }

    return { data, width: chunkWidth, height: chunkHeight };
  } catch {
    return null;
  }
}

// --- Read a single pixel from a decoded chunk ---

function readPixel(
  chunk: DecodedChunk,
  srtmBounds: ReturnType<typeof srtmNameToBounds>,
  pixel: ReturnType<typeof latLonToPixel>,
): number | null {
  const localRow = pixel.row - Math.floor(pixel.row / 256) * 256;
  const localCol = pixel.col - Math.floor(pixel.col / 256) * 256;
  if (localRow >= chunk.height || localCol >= chunk.width) return null;
  const val = chunk.data[localRow * chunk.width + localCol];
  return val === -32768 ? null : val;
}

// --- GEBCO 2025 client-side strip fetch and pixel decode ---

async function fetchGebcoStrip(quadName: string, row: number): Promise<Uint8Array | null> {
  const cacheKey = `${quadName}:${row}`;
  const cached = gebcoStripCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHUNK_TTL) return cached.strip;

  const stripOffset = GEBCO_STRIP_DATA_START + row * GEBCO_STRIP_BYTES;
  const url = `${GEBCO_CEDA_BASE}/${quadName}`;

  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=${stripOffset}-${stripOffset + GEBCO_STRIP_BYTES - 1}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status !== 206 && res.status !== 200) return null;

    const strip = new Uint8Array(await res.arrayBuffer());
    cacheEvict(gebcoStripCache);
    gebcoStripCache.set(cacheKey, { strip, ts: Date.now() });
    return strip;
  } catch {
    return null;
  }
}

function readGebcoPixel(strip: Uint8Array, col: number): number | null {
  const byteOffset = col * 2;
  if (byteOffset + 2 > strip.length) return null;

  const lowByte = strip[byteOffset];
  const highByte = strip[byteOffset + 1];
  const value = (highByte << 8) | lowByte;
  const signedValue = value >= 32768 ? value - 65536 : value;

  if (signedValue > 8850 || signedValue < -11000) return null;
  return signedValue;
}

async function clientGebcoElevation(
  lat: number,
  lon: number,
): Promise<{
  elevation: number;
  surfaceType: "land" | "ocean";
  tile: string;
} | null> {
  const quadName = latLonToQuadName(lat, lon);
  const bounds = quadNameToBounds(quadName);
  if (!bounds) return null;

  const { row, col } = gebcoLatLonToPixel(lat, lon, bounds);
  const strip = await fetchGebcoStrip(quadName, row);
  if (!strip) return null;

  const elevation = readGebcoPixel(strip, col);
  if (elevation === null) return null;

  return {
    elevation,
    surfaceType: elevation < 0 ? "ocean" : "land",
    tile: quadName,
  };
}

// --- Public API: single point elevation ---

/**
 * Get elevation for a single geographic point.
 *
 * Tries client-side SRTM fetch first (HuggingFace), then GEBCO for ocean points.
 * Falls back to /api/elevation server endpoint if client-side fails.
 *
 * @param lat - Latitude in degrees (-90 to 90)
 * @param lon - Longitude in degrees (-180 to 180)
 * @returns Elevation result with height in meters, surface type, and tile ID; null on failure
 */
export async function getClientElevation(
  lat: number,
  lon: number,
): Promise<{
  elevation: number | null;
  surfaceType: "land" | "ocean" | "unknown";
  tile: string;
} | null> {
  // Normalize longitude to -180..180 (handles map wrap-around coordinates like 540)
  lon = ((lon % 360) + 540) % 360 - 180;

  // Try client-side first
  try {
    const result = await clientElevationDirect(lat, lon);
    if (result) return result;
  } catch {
    // Fall through to server
  }

  // Fallback: server endpoint
  try {
    const res = await fetch(`/api/elevation?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
    if (res.ok) {
      const d = await res.json();
      if (d.elevation !== null) {
        return {
          elevation: d.elevation,
          surfaceType: d.surface_type || "unknown",
          tile: d.tile || "",
        };
      }
    }
  } catch {
    // Server unreachable
  }

  return null;
}

async function clientElevationDirect(
  lat: number,
  lon: number,
): Promise<{
  elevation: number | null;
  surfaceType: "land" | "ocean" | "unknown";
  tile: string;
} | null> {
  if (!isWithinSRTM(lat, lon)) return null;

  const srtmName = latLonToSrtmName(lat, lon);
  const srtmBounds = srtmNameToBounds(srtmName);
  const pixel = latLonToPixel(lat, lon, srtmBounds);

  const chunkRow = Math.floor(pixel.row / 256);
  const chunkCol = Math.floor(pixel.col / 256);

  const chunk = await getDecodedChunk(srtmName, chunkRow, chunkCol);
  if (!chunk) return null;

  const elevation = readPixel(chunk, srtmBounds, pixel);
  if (elevation === null) {
    // SRTM NODATA = ocean or outside coverage — try GEBCO 2025
    try {
      const gebco = await clientGebcoElevation(lat, lon);
      if (gebco) return gebco;
    } catch {
      // GEBCO unavailable, fall through
    }
    return null;
  }

  return {
    elevation,
    surfaceType: elevation < 0 ? "ocean" : "land",
    tile: getTileBase(srtmName),
  };
}

// --- Public API: batch elevation ---

/**
 * Get elevation for multiple geographic points in batch.
 *
 * Tries client-side batch processing first, falls back to /api/elevation/batch.
 *
 * @param points - Array of {lat, lon, id?} coordinates (max 2000)
 * @returns Array of results preserving input order, with optional id passthrough
 */
export async function getClientElevationBatch(
  points: Array<{ lat: number; lon: number; id?: string }>,
): Promise<Array<{ lat: number; lon: number; elevation: number | null; id?: string }>> {
  // Normalize longitudes to -180..180 (handles map wrap-around)
  const normalizedPoints = points.map((p) => ({
    ...p,
    lon: ((p.lon % 360) + 540) % 360 - 180,
  }));

  // Try client-side batch first
  try {
    return await clientBatchDirect(normalizedPoints);
  } catch {
    // Fall through to server
  }

  // Fallback: server batch endpoint
  try {
    const res = await fetch("/api/elevation/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: normalizedPoints }),
    });
    if (res.ok) {
      const d = await res.json();
      return d.results || points.map((p) => ({ ...p, elevation: null }));
    }
  } catch {
    // Server unreachable
  }

  return points.map((p) => ({ ...p, elevation: null }));
}

async function clientBatchDirect(
  points: Array<{ lat: number; lon: number; id?: string }>,
): Promise<Array<{ lat: number; lon: number; elevation: number | null; id?: string }>> {
  // Group points by SRTM tile
  const tileGroups = new Map<string, Array<{ idx: number; lat: number; lon: number; id?: string }>>();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!isWithinSRTM(p.lat, p.lon)) continue;
    const name = latLonToSrtmName(p.lat, p.lon);
    if (!tileGroups.has(name)) tileGroups.set(name, []);
    tileGroups.get(name)!.push({ idx: i, lat: p.lat, lon: p.lon, id: p.id });
  }

  const results: Array<{ lat: number; lon: number; elevation: number | null; id?: string }> = points.map((p) => ({
    ...p,
    elevation: null,
  }));

  for (const [srtmName, pts] of tileGroups) {
    const srtmBounds = srtmNameToBounds(srtmName);
    const chunkCache = new Map<string, DecodedChunk | null>();

    for (const pt of pts) {
      const pixel = latLonToPixel(pt.lat, pt.lon, srtmBounds);
      const chunkRow = Math.floor(pixel.row / 256);
      const chunkCol = Math.floor(pixel.col / 256);
      const ck = `${chunkRow}:${chunkCol}`;

      if (!chunkCache.has(ck)) {
        chunkCache.set(ck, await getDecodedChunk(srtmName, chunkRow, chunkCol));
      }

      const chunk = chunkCache.get(ck);
      if (chunk) {
        const elev = readPixel(chunk, srtmBounds, pixel);
        if (elev !== null) {
          results[pt.idx] = { ...pt, elevation: elev };
        } else {
          // SRTM NODATA — try GEBCO for this point
          try {
            const gebco = await clientGebcoElevation(pt.lat, pt.lon);
            if (gebco) {
              results[pt.idx] = { ...pt, elevation: gebco.elevation };
            }
          } catch {
            /* skip */
          }
        }
      }
    }
  }

  // For points outside SRTM coverage, try GEBCO
  for (let i = 0; i < points.length; i++) {
    if (results[i].elevation !== null) continue;
    const p = points[i];
    try {
      const gebco = await clientGebcoElevation(p.lat, p.lon);
      if (gebco) {
        results[i] = { ...results[i], elevation: gebco.elevation };
      }
    } catch {
      /* skip */
    }
  }

  return results;
}

// --- Public API: tile data for Cesium terrain provider ---

const TILE_SIZE = 256;
const NODATA = -32768;

/**
 * Get terrain tile data for CesiumJS terrain provider.
 *
 * Returns a Float32Array of height values for a 256x256 tile at the given z/x/y.
 *
 * @param z - Zoom level
 * @param x - Tile column
 * @param y - Tile row
 * @returns Heights array with dimensions, or null if tile unavailable
 */
export async function getClientTileData(
  z: number,
  x: number,
  y: number,
): Promise<{ heights: Float32Array; width: number; height: number } | null> {
  try {
    return await clientTileDataDirect(z, x, y);
  } catch {
    return null;
  }
}

async function clientTileDataDirect(
  z: number,
  x: number,
  y: number,
): Promise<{ heights: Float32Array; width: number; height: number } | null> {
  const bounds = tileToLatLon(z, x, y);

  if (bounds.south > 60 || bounds.north < -60 || bounds.west > 181 || bounds.east < -181) {
    return { heights: new Float32Array(TILE_SIZE * TILE_SIZE), width: TILE_SIZE, height: TILE_SIZE };
  }

  // Find overlapping SRTM tiles
  const srtmTiles = new Set<string>();
  for (const lat of [bounds.north - 0.001, (bounds.north + bounds.south) / 2, bounds.south + 0.001]) {
    for (const lon of [bounds.west + 0.001, (bounds.west + bounds.east) / 2, bounds.east - 0.001]) {
      if (isWithinSRTM(lat, lon)) {
        srtmTiles.add(latLonToSrtmName(lat, lon));
      }
    }
  }

  const data = new Int16Array(TILE_SIZE * TILE_SIZE).fill(NODATA);

  for (const srtmName of srtmTiles) {
    const srtmBounds = srtmNameToBounds(srtmName);
    const overlapNorth = Math.min(bounds.north, srtmBounds.latMax);
    const overlapSouth = Math.max(bounds.south, srtmBounds.latMin);
    const overlapWest = Math.max(bounds.west, srtmBounds.lonMin);
    const overlapEast = Math.min(bounds.east, srtmBounds.lonMax);
    if (overlapNorth <= overlapSouth || overlapWest >= overlapEast) continue;

    const startPixel = latLonToPixel(overlapNorth, overlapWest, srtmBounds);
    const endPixel = latLonToPixel(overlapSouth, overlapEast, srtmBounds);
    const startCR = Math.floor(startPixel.row / 256);
    const startCC = Math.floor(startPixel.col / 256);
    const endCR = Math.floor(endPixel.row / 256);
    const endCC = Math.floor(endPixel.col / 256);

    const chunkCache = new Map<string, DecodedChunk | null>();

    for (let cr = startCR; cr <= endCR; cr++) {
      for (let cc = startCC; cc <= endCC; cc++) {
        const ck = `${cr}:${cc}`;
        if (!chunkCache.has(ck)) {
          chunkCache.set(ck, await getDecodedChunk(srtmName, cr, cc));
        }
        const chunk = chunkCache.get(ck);
        if (!chunk) continue;

        const latStep = (bounds.north - bounds.south) / TILE_SIZE;
        const lonStep = (bounds.east - bounds.west) / TILE_SIZE;

        for (let py = 0; py < TILE_SIZE; py++) {
          const lat = bounds.north - (py + 0.5) * latStep;
          if (lat > srtmBounds.latMax || lat < srtmBounds.latMin) continue;
          for (let px = 0; px < TILE_SIZE; px++) {
            const lon = bounds.west + (px + 0.5) * lonStep;
            if (lon < srtmBounds.lonMin || lon > srtmBounds.lonMax) continue;

            const pixel = latLonToPixel(lat, lon, srtmBounds);
            const lRow = pixel.row - Math.floor(pixel.row / 256) * 256;
            const lCol = pixel.col - Math.floor(pixel.col / 256) * 256;
            if (lRow < chunk.height && lCol < chunk.width) {
              const val = chunk.data[lRow * chunk.width + lCol];
              if (val !== NODATA) data[py * TILE_SIZE + px] = val;
            }
          }
        }
      }
    }
  }

  const heights = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) heights[i] = data[i];

  return { heights, width: TILE_SIZE, height: TILE_SIZE };
}
