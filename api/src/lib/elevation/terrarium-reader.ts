/**
 * Get elevation at a lat/lon point using HuggingFace SRTM 30m chunk backend.
 *
 * Uses lightweight point-elevation lookup that only fetches the single
 * 256x256 chunk needed, avoiding full tile assembly.
 */

import { getPointElevation } from "@/lib/point-elevation";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

interface ElevationResult {
  elevation: number | null;
  surface_type: "land" | "inland_water" | "ocean" | "seafloor" | "unknown";
  unit: string;
  location: { lat: number; lon: number };
  source: string;
  tile: string;
  resolution: number;
}

/**
 * Get elevation at a lat/lon using HuggingFace SRTM 30m chunks.
 * Uses lightweight point lookup (single chunk fetch, not full tile assembly).
 */
export async function getElevationFromR2(lat: number, lon: number): Promise<ElevationResult> {
  try {
    const result = await getPointElevation(lat, lon, HF_BACKEND);
    if (result) {
      return {
        elevation: result.elevation,
        surface_type: result.surfaceType,
        unit: "meters",
        location: { lat, lon },
        source: "huggingface",
        tile: result.tile,
        resolution: 30,
      };
    }
  } catch {
    // Fall through to null result
  }

  return {
    elevation: null,
    surface_type: "unknown",
    unit: "meters",
    location: { lat, lon },
    source: "huggingface",
    tile: "",
    resolution: 30,
  };
}
