import { NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * GET /api/gps-jamming
 *
 * Returns a list of GPS jamming hex cells with:
 *   lat, lon, resolution, intensity (0-1), source, timestamp
 *
 * This is a placeholder stub with realistic demo data based on
 * publicly known GPS interference zones (Ukraine conflict zone,
 * Middle East, Taiwan Strait, Russian border areas).
 */
export async function GET() {
  const hexes = [
    // Ukraine conflict zone — well documented GPS interference
    {
      lat: 50.45,
      lon: 30.52,
      resolution: 6,
      intensity: 0.9,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 48.5,
      lon: 35.0,
      resolution: 6,
      intensity: 0.85,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 49.8,
      lon: 33.5,
      resolution: 6,
      intensity: 0.7,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 51.2,
      lon: 28.6,
      resolution: 6,
      intensity: 0.65,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 47.8,
      lon: 37.2,
      resolution: 6,
      intensity: 0.8,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },

    // Middle East — documented interference areas
    {
      lat: 31.5,
      lon: 34.8,
      resolution: 6,
      intensity: 0.6,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 29.5,
      lon: 45.0,
      resolution: 6,
      intensity: 0.5,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 33.3,
      lon: 44.4,
      resolution: 6,
      intensity: 0.45,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },

    // Taiwan Strait — documented interference
    {
      lat: 24.5,
      lon: 119.5,
      resolution: 6,
      intensity: 0.65,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 23.8,
      lon: 118.2,
      resolution: 6,
      intensity: 0.55,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },

    // Russian border / airspace
    {
      lat: 60.0,
      lon: 30.0,
      resolution: 6,
      intensity: 0.4,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 55.7,
      lon: 37.6,
      resolution: 6,
      intensity: 0.55,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 59.9,
      lon: 30.3,
      resolution: 6,
      intensity: 0.5,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },

    // Korean Peninsula
    {
      lat: 37.5,
      lon: 127.0,
      resolution: 6,
      intensity: 0.5,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },

    // Eastern Mediterranean
    {
      lat: 35.0,
      lon: 33.0,
      resolution: 6,
      intensity: 0.4,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
  ];

  return NextResponse.json(
    { hexes },
    {
      headers: {
        ...CORS_HEADERS,
        // GPS jamming zones change slowly — cache for 10 minutes
        "Cache-Control": "public, max-age=600",
      },
    },
  );
}
