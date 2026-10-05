import { NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * GET /api/gps-jamming
 *
 * Returns a list of GPS interference hex cells with:
 *   lat, lon, resolution, intensity (0-1), source, timestamp
 *
 * Data honesty: this is a STATIC REFERENCE DATASET, not live detection.
 * There is no freely available real-time GPS-jamming feed; the coordinates
 * and intensities below are approximate survey values for publicly
 * documented interference regions (Ukraine conflict zone, Middle East,
 * Taiwan Strait, Russian border areas, Korean Peninsula, Eastern
 * Mediterranean). The response marks itself `simulated: true` and carries a
 * `notice` so clients can disclose that to users.
 */
const SOURCE_LABEL = "OpenZenith reference survey (static)";

const NOTICE =
  "Static reference dataset of publicly documented GPS interference zones. " +
  "Positions and intensities are approximate survey values, not real-time detections.";

export function GET() {
  const hexes: Array<{
    lat: number;
    lon: number;
    resolution: number;
    intensity: number;
    source: string;
    timestamp: string;
  }> = [
    // Ukraine conflict zone — well documented GPS interference
    {
      lat: 50.45,
      lon: 30.52,
      resolution: 6,
      intensity: 0.9,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
    {
      lat: 48.5,
      lon: 35.0,
      resolution: 6,
      intensity: 0.85,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
    {
      lat: 49.8,
      lon: 33.5,
      resolution: 6,
      intensity: 0.7,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
    {
      lat: 51.2,
      lon: 28.6,
      resolution: 6,
      intensity: 0.65,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
    {
      lat: 47.8,
      lon: 37.2,
      resolution: 6,
      intensity: 0.8,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },

    // Middle East — documented interference areas
    {
      lat: 31.5,
      lon: 34.8,
      resolution: 6,
      intensity: 0.6,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
    {
      lat: 29.5,
      lon: 45.0,
      resolution: 6,
      intensity: 0.5,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
    {
      lat: 33.3,
      lon: 44.4,
      resolution: 6,
      intensity: 0.45,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },

    // Taiwan Strait — documented interference
    {
      lat: 24.5,
      lon: 119.5,
      resolution: 6,
      intensity: 0.65,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
    {
      lat: 23.8,
      lon: 118.2,
      resolution: 6,
      intensity: 0.55,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },

    // Russian border / airspace
    {
      lat: 60.0,
      lon: 30.0,
      resolution: 6,
      intensity: 0.4,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
    {
      lat: 55.7,
      lon: 37.6,
      resolution: 6,
      intensity: 0.55,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
    {
      lat: 59.9,
      lon: 30.3,
      resolution: 6,
      intensity: 0.5,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },

    // Korean Peninsula
    {
      lat: 37.5,
      lon: 127.0,
      resolution: 6,
      intensity: 0.5,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },

    // Eastern Mediterranean
    {
      lat: 35.0,
      lon: 33.0,
      resolution: 6,
      intensity: 0.4,
      source: SOURCE_LABEL,
      timestamp: new Date().toISOString(),
    },
  ];

  return NextResponse.json(
    { hexes, simulated: true, notice: NOTICE },
    {
      headers: {
        ...CORS_HEADERS,
        // GPS jamming zones change slowly — cache for 10 minutes
        "Cache-Control": "public, max-age=600",
      },
    },
  );
}
