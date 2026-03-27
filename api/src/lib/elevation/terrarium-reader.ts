/**
 * Read elevation from Terrarium PNG tiles served from R2.
 *
 * Fetches the tile containing the query point, decodes the Terrarium
 * encoding, and bilinearly interpolates to get the elevation at the exact lat/lon.
 *
 * Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768
 */

const DEM_TILE_BASE = "/api/dem-tile";

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
 * Get the tile coordinates and pixel offset for a given lat/lon at a zoom level.
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

/**
 * Decode a single pixel from ImageData using Terrarium encoding.
 */
function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Get elevation at a lat/lon by fetching the Terrarium PNG tile from R2
 * and decoding the relevant pixel.
 *
 * Uses zoom 8 tiles ( Copernicus GLO-30 + GEBCO 2025, ~1.7km resolution).
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

  // Try zoom 8 first (best resolution available in R2), then fall back
  for (const zoom of [8, 7, 6, 5]) {
    const { x, y } = latLonToTile(lat, lon, zoom);
    const tileUrl = `${DEM_TILE_BASE}/${zoom}/${x}/${y}`;

    try {
      const res = await fetch(tileUrl);
      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("image")) continue;

      const source = res.headers.get("x-dem-tile-source") || "unknown";
      if (source === "fallback-flat" || source === "fallback-missing") continue;

      const imageBuf = await res.arrayBuffer();

      // Decode PNG to ImageData
      const imageData = await decodePNG(imageBuf);
      if (!imageData) continue;

      const { width, height, pixels } = imageData;

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
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): number {
  const offset = (y * width + x) * 4;
  return decodeTerrarium(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
}

/**
 * Decode a PNG buffer to ImageData using OffscreenCanvas.
 */
async function decodePNG(
  buffer: ArrayBuffer,
): Promise<{ width: number; height: number; pixels: Uint8ClampedArray } | null> {
  try {
    const blob = new Blob([buffer], { type: "image/png" });
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return {
      width: imageData.width,
      height: imageData.height,
      pixels: imageData.data,
    };
  } catch {
    return null;
  }
}
