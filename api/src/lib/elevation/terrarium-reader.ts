/**
 * Get elevation at a lat/lon point using HuggingFace SRTM 30m chunk backend.
 *
 * Assembles elevation data on-the-fly from HuggingFace datasets and
 * bilinearly interpolates for precise elevation.
 */

import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

interface ElevationResult {
  elevation: number | null;
  surface_type: "land" | "ocean" | "unknown";
  unit: string;
  location: { lat: number; lon: number };
  source: string;
  tile: string;
  resolution: number;
}

function latLonToTile(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

/**
 * Get elevation at a lat/lon using HuggingFace SRTM 30m chunks.
 *
 * Uses zoom 8 tiles (SRTM 30m, ~1.7km resolution).
 * Falls back through lower zooms if assembly fails.
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
    source: "huggingface",
    tile: "",
    resolution: 1700,
  };

  for (const zoom of [8, 7, 6, 5]) {
    try {
      const { x, y } = latLonToTile(lat, lon, zoom);
      const tileData = await getTileData(zoom, x, y, HF_BACKEND);

      const w = tileData.width;
      const h = tileData.height;

      // Convert lat/lon to fractional pixel coordinates within the tile
      const n = 2 ** zoom;
      const xFrac = ((lon + 180) / 360) * n - x;
      const latRad = (lat * Math.PI) / 180;
      const yFrac =
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - y;

      // Bilinear interpolation from the 4 nearest pixels
      const px = xFrac * (w - 1);
      const py = yFrac * (h - 1);
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const x1 = Math.min(x0 + 1, w - 1);
      const y1 = Math.min(y0 + 1, h - 1);
      const fx = px - x0;
      const fy = py - y0;

      const h00 = tileData.data[y0 * w + x0];
      const h10 = tileData.data[y0 * w + x1];
      const h01 = tileData.data[y1 * w + x0];
      const h11 = tileData.data[y1 * w + x1];

      // Skip if all neighbors are nodata
      if (h00 === -32768 && h10 === -32768 && h01 === -32768 && h11 === -32768) continue;

      const elevation =
        h00 * (1 - fx) * (1 - fy) +
        h10 * fx * (1 - fy) +
        h01 * (1 - fx) * fy +
        h11 * fx * fy;

      const resolution = zoom === 8 ? 1700 : zoom === 7 ? 3400 : 6800;

      return {
        elevation: Math.round(elevation * 10) / 10,
        surface_type: (elevation < 0 ? "ocean" : "land") as "land" | "ocean",
        unit: "meters",
        location: { lat, lon },
        source: "huggingface",
        tile: `${zoom}/${x}/${y}`,
        resolution,
      };
    } catch {
      continue;
    }
  }

  return nullResult;
}
