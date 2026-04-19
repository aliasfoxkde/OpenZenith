import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";
import { zlibSync } from "fflate";

/**
 * Elevation accuracy/resolution heatmap tile endpoint.
 *
 * Generates a static raster showing which elevation data source covers
 * each pixel and at what resolution. This is a pure-compute endpoint —
 * no DEM assembly needed. Coverage is determined by geographic coordinates.
 *
 * Color coding:
 *   Cyan         → 2m (ArcticDEM / REMA polar regions)
 *   Bright green → 10m (Copernicus EEA 10m, Europe only)
 *   Green        → 30m (SRTM / Copernicus GLO-30, ±60° lat land)
 *   Yellow-green → 90m (Copernicus GLO-90, rest of land)
 *   Blue         → 450m (GEBCO 2025, ocean)
 *   Dark gray    → No data / unknown
 *
 * Tile URL pattern: /api/elevation-accuracy/{z}/{x}/{y}
 * Format: PNG 256x256
 */

export const runtime = "edge";

const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=31536000, s-maxage=31536000", // immutable — coverage doesn't change
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
};

// ─── Coverage regions (bounding boxes) ───

// Copernicus EEA 10m: rough European bounding box
const EEA10_BOUNDS = { latMin: 34, latMax: 72, lonMin: -25, lonMax: 45 };

// SRTM / GLO-30 coverage: ±60° latitude, land only
const SRTM_LAT_MAX = 60;
const SRTM_LAT_MIN = -60;

// ArcticDEM: lat > 60°N (land)
const ARCTIC_LAT_MIN = 60;

// REMA: Antarctica (lat < -60°)
const REMA_LAT_MAX = -60;

// ─── Accuracy classification ───

// Resolution tiers (ordered best → worst)
const ACCURACY_COLORS: Record<string, [number, number, number]> = {
  "2m_arctic": [0, 210, 230],       // cyan
  "2m_rema": [0, 210, 230],          // cyan
  "10m_eea": [34, 197, 94],          // bright green
  "30m_srtm": [34, 139, 34],         // green
  "90m_glo90": [154, 205, 50],       // yellow-green
  "450m_gebco": [33, 113, 181],      // blue
  "nodata": [20, 22, 28],            // dark gray (no data)
};

/**
 * Classify a point's elevation data source resolution.
 * Returns a color based on the best available source.
 *
 * Priority: ArcticDEM 2m > REMA 2m > EEA 10m > GLO-30 30m > GLO-90 90m > GEBCO 450m
 */
function classifyResolution(lat: number, lon: number): [number, number, number] {
  // Check for NODATA regions (no data from any source)
  // All sources have global or near-global coverage via GEBCO fallback

  if (lat > ARCTIC_LAT_MIN) {
    // ArcticDEM covers most land above 60°N (Greenland, Alaska, Canada Arctic, Scandinavia, Siberia)
    // Rough heuristic: assume land if not obvious ocean
    // (Without a land mask we approximate — most points >60°N are land or ice)
    if (lon > -180 && lon < 180) {
      return ACCURACY_COLORS["2m_arctic"];
    }
  }

  if (lat < REMA_LAT_MAX) {
    // REMA covers Antarctica
    if (lon > -180 && lon < 180) {
      return ACCURACY_COLORS["2m_rema"];
    }
  }

  // Check EEA 10m coverage (Europe)
  if (
    lat >= EEA10_BOUNDS.latMin &&
    lat <= EEA10_BOUNDS.latMax &&
    lon >= EEA10_BOUNDS.lonMin &&
    lon <= EEA10_BOUNDS.lonMax
  ) {
    return ACCURACY_COLORS["10m_eea"];
  }

  // SRTM / GLO-30 coverage (±60° latitude, land)
  if (lat >= SRTM_LAT_MIN && lat <= SRTM_LAT_MAX) {
    // Within SRTM coverage — 30m resolution
    return ACCURACY_COLORS["30m_srtm"];
  }

  // Rest of land outside ±60° — GLO-90 90m
  // We don't have a land mask here, so GLO-90 is approximate for mid-latitudes
  // Points in the gap between SRTM (±60°) and polar (±60°) use GLO-90
  return ACCURACY_COLORS["90m_glo90"];
}

/**
 * Simplified land detection using continent bounding polygons.
 *
 * This is NOT a precise coastline — it's a rough heuristic that covers
 * the major landmasses. Ocean areas between landmasses may be incorrectly
 * classified as land, but the visual result is acceptable for an overlay.
 *
 * For accurate land/ocean detection, use Natural Earth coastline data.
 */
const LAND_BOXES: Array<{ latMin: number; latMax: number; lonMin: number; lonMax: number }> = [
  // North America
  { latMin: 25, latMax: 72, lonMin: -170, lonMax: -52 },
  // Central America
  { latMin: 7, latMax: 25, lonMin: -120, lonMax: -77 },
  // South America
  { latMin: -56, latMax: 13, lonMin: -82, lonMax: -34 },
  // Europe
  { latMin: 36, latMax: 71, lonMin: -10, lonMax: 40 },
  // Scandinavia
  { latMin: 55, latMax: 71, lonMin: 4, lonMax: 31 },
  // UK & Ireland
  { latMin: 50, latMax: 60, lonMin: -11, lonMax: 2 },
  // Africa
  { latMin: -35, latMax: 37, lonMin: -18, lonMax: 52 },
  // Middle East
  { latMin: 12, latMax: 42, lonMin: 25, lonMax: 63 },
  // Russia / Central Asia
  { latMin: 40, latMax: 72, lonMin: 40, lonMax: 180 },
  // South/East Asia
  { latMin: -10, latMax: 40, lonMin: 63, lonMax: 145 },
  // Japan
  { latMin: 30, latMax: 46, lonMin: 128, lonMax: 146 },
  // China / Mongolia
  { latMin: 18, latMax: 54, lonMin: 73, lonMax: 135 },
  // India
  { latMin: 8, latMax: 35, lonMin: 68, lonMax: 97 },
  // Southeast Asia / Indonesia
  { latMin: -10, latMax: 20, lonMin: 95, lonMax: 141 },
  // Australia
  { latMin: -44, latMax: -10, lonMin: 112, lonMax: 154 },
  // New Zealand
  { latMin: -47, latMax: -34, lonMin: 166, lonMax: 179 },
  // Greenland
  { latMin: 60, latMax: 84, lonMin: -73, lonMax: -12 },
  // Antarctica
  { latMin: -90, latMax: -60, lonMin: -180, lonMax: 180 },
  // Arctic Canada (high latitude land)
  { latMin: 60, latMax: 84, lonMin: -141, lonMax: -52 },
  // Iceland
  { latMin: 63, latMax: 67, lonMin: -25, lonMax: -13 },
];

// Ocean polygons — areas within land boxes that are known to be ocean
const OCEAN_BOXES: Array<{ latMin: number; latMax: number; lonMin: number; lonMax: number }> = [
  // Hudson Bay
  { latMin: 51, latMax: 64, lonMin: -95, lonMax: -78 },
  // Great Lakes (partially)
  { latMin: 41, latMax: 49, lonMin: -92, lonMax: -75 },
  // Mediterranean
  { latMin: 30, latMax: 46, lonMin: -6, lonMax: 36 },
  // Baltic Sea
  { latMin: 53, latMax: 66, lonMin: 9, lonMax: 30 },
  // Caspian Sea
  { latMin: 36, latMax: 47, lonMin: 46, lonMax: 54 },
  // Persian Gulf
  { latMin: 23, latMax: 31, lonMin: 47, lonMax: 57 },
  // Red Sea
  { latMin: 12, latMax: 29, lonMin: 31, lonMax: 44 },
  // Bay of Bengal
  { latMin: 5, latMax: 23, lonMin: 80, lonMax: 100 },
  // Gulf of Mexico
  { latMin: 18, latMax: 30, lonMin: -98, lonMax: -80 },
  // Caribbean Sea
  { latMin: 10, latMax: 24, lonMin: -90, lonMax: -60 },
];

function isLandHeuristic(lat: number, lon: number): boolean {
  // Check ocean exclusions first
  for (const box of OCEAN_BOXES) {
    if (lat >= box.latMin && lat <= box.latMax && lon >= box.lonMin && lon <= box.lonMax) {
      return false;
    }
  }

  // Check if in any land box
  for (const box of LAND_BOXES) {
    if (lat >= box.latMin && lat <= box.latMax && lon >= box.lonMin && lon <= box.lonMax) {
      return true;
    }
  }

  // Default: ocean
  return false;
}

/**
 * Convert tile z/x/y to lat/lon bounds.
 */
function tileToLatLon(z: number, x: number, y: number) {
  const n = 2 ** z;
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  return { north, south, west, east };
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;

  const tileYStr = y.replace(/\.png$/, "");
  const zoom = parseInt(z, 10);
  const tileX = parseInt(x, 10);
  const tileY = parseInt(tileYStr, 10);

  if (isNaN(zoom) || zoom < 0 || zoom > 14 || isNaN(tileX) || isNaN(tileY)) {
    return NextResponse.json({ error: "Invalid tile coordinates" }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const png = encodeAccuracyTile(zoom, tileX, tileY);
    return new Response(png.buffer as ArrayBuffer, {
      headers: {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        "X-Tile-Type": "elevation-accuracy",
      },
    });
  } catch (error) {
    console.error(`Accuracy tile error: ${zoom}/${tileX}/${tileY}`, error);
    const fallback = encodeAccuracyTile(0, 0, 0); // fallback
    return new Response(fallback.buffer as ArrayBuffer, {
      status: 200,
      headers: { ...CACHE_HEADERS, "Content-Type": "image/png", "X-Tile-Type": "fallback" },
    });
  }
}

/**
 * Encode a 256x256 accuracy heatmap tile as PNG.
 */
function encodeAccuracyTile(z: number, x: number, y: number): Uint8Array {
  const SIZE = 256;
  const bounds = tileToLatLon(z, x, y);

  const raw = new Uint8Array(SIZE * (1 + SIZE * 3));
  const latStep = (bounds.north - bounds.south) / SIZE;
  const lonStep = (bounds.east - bounds.west) / SIZE;

  for (let py = 0; py < SIZE; py++) {
    const rowOff = py * (1 + SIZE * 3);
    raw[rowOff] = 0; // PNG filter: None

    const lat = bounds.north - (py + 0.5) * latStep;

    for (let px = 0; px < SIZE; px++) {
      const lon = bounds.west + (px + 0.5) * lonStep;
      const pixOff = rowOff + 1 + px * 3;

      // Land/ocean detection using simplified continent bounding boxes.
      // Not perfect, but good enough for a resolution heatmap overlay.
      const isLand = isLandHeuristic(lat, lon);

      if (!isLand) {
        // Ocean → GEBCO 450m blue
        const [r, g, b] = ACCURACY_COLORS["450m_gebco"];
        raw[pixOff] = r;
        raw[pixOff + 1] = g;
        raw[pixOff + 2] = b;
      } else {
        const [r, g, b] = classifyResolution(lat, lon);
        raw[pixOff] = r;
        raw[pixOff + 1] = g;
        raw[pixOff + 2] = b;
      }
    }
  }

  const compressed = zlibSync(raw, { level: 1 });
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, SIZE);
  ihdrView.setUint32(4, SIZE);
  ihdrData[8] = 8;
  ihdrData[9] = 2;

  const ihdr = pngChunk("IHDR", ihdrData);
  const idat = pngChunk("IDAT", compressed);
  const iend = pngChunk("IEND", new Uint8Array(0));

  const result = new Uint8Array(signature.length + ihdr.length + idat.length + iend.length);
  let off = 0;
  result.set(signature, off); off += signature.length;
  result.set(ihdr, off); off += ihdr.length;
  result.set(idat, off); off += idat.length;
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
