/**
 * GEBCO 2025 COG reader for bathymetry queries.
 *
 * Reads elevation from GEBCO 2025 quadrant GeoTIFFs using HTTP range requests.
 *
 * GEBCO 2025 quadrants (hosted by CEDA):
 * - Int16, 21600x21600 pixels (90°x90° at 15-arc-second)
 * - Strip-based (21600 strips of 1 row each)
 * - Uncompressed, contiguous strips starting at byte 135948
 * - Strip size = 21600 * 2 = 43,200 bytes
 * - No explicit NODATA value (Int16 range: -32768 to 32767)
 * - Negative values = below sea level (ocean depth)
 * - Positive values = above sea level (land/ice elevation)
 *
 * All 8 quadrant files share identical TIFF structure, so strip offsets
 * are computed arithmetically — no header parsing needed.
 */

import {
  latLonToQuadName,
  quadNameToBounds,
  latLonToPixel,
} from "./tile-math";

const BYTES_PER_PIXEL = 2; // Int16
const STRIP_BYTES = 21600 * BYTES_PER_PIXEL; // 43,200 bytes per row
const STRIP_DATA_START = 135948; // All strips are contiguous starting at this byte

// Base URL for GEBCO tile files.
// Production: CEDA hosts GEBCO 2025 GeoTIFFs with CORS + range request support.
// Override with GEBCO_TILE_URL env var for self-hosted files.
function getBaseUrl(): string {
  return process.env.GEBCO_TILE_URL || "https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/ice_surface_elevation/geotiff";
}

/**
 * Look up elevation from a GEBCO 2025 quadrant file.
 * Returns negative values for ocean depth, positive for land/ice elevation.
 *
 * Optimization: Only fetches a single ~43KB strip per query.
 * No header parsing — strip offsets are computed from the known TIFF layout.
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

  // Compute strip offset directly — no header fetch needed
  const stripOffset = STRIP_DATA_START + row * STRIP_BYTES;

  // Fetch just the single strip containing our target pixel (~43KB)
  const res = await fetch(url, {
    headers: {
      Range: `bytes=${stripOffset}-${stripOffset + STRIP_BYTES - 1}`,
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
