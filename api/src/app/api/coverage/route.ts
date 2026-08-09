import { NextResponse } from "next/server";
import { CORS_HEADERS, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * GET /api/coverage
 *
 * Returns metadata about available elevation datasets and their
 * spatial coverage areas on the globe.
 *
 * Tile imagery is served via: /api/elevation-accuracy/{z}/{x}/{y}
 */
export async function GET() {
  const datasets = [
    {
      id: "arcticdem",
      name: "ArcticDEM 2m",
      resolution: 2,
      unit: "meters",
      source: "Polar Geospatial Center / NGA",
      url: "https://www.pgc.nasa.gov/data-and-tools/arcticdem",
      coverage: { minLat: 60, maxLat: 90 },
      color: "#00ccff",
    },
    {
      id: "rema",
      name: "REMA 2m",
      resolution: 2,
      unit: "meters",
      source: "Polar Geospatial Center / NGA",
      url: "https://www.pgc.nasa.gov/data-and-tools/rema",
      coverage: { minLat: -90, maxLat: -60 },
      color: "#00ccff",
    },
    {
      id: "copernicus_eea",
      name: "Copernicus EEA 10m",
      resolution: 10,
      unit: "meters",
      source: "European Environment Agency",
      url: "https://eea.europa.eu",
      coverage: { region: "europe" },
      color: "#00ff88",
    },
    {
      id: "srtm_glo30",
      name: "SRTM / GLO-30 30m",
      resolution: 30,
      unit: "meters",
      source: "NASA/USGS CGIAR",
      url: "https://srtm.csi.cgiar.org",
      coverage: { minLat: -60, maxLat: 60, landOnly: true },
      color: "#009966",
    },
    {
      id: "glo90",
      name: "GLO-90 90m",
      resolution: 90,
      unit: "meters",
      source: "Copernicus Land Monitoring Service",
      url: "https://land.copernicus.eu/imagery-in-situ/eu-dem",
      coverage: { landOnly: true },
      color: "#88cc00",
    },
    {
      id: "gebco",
      name: "GEBCO 450m",
      resolution: 450,
      unit: "meters",
      source: "GEBCO Seabed 2030 / NOAA",
      url: "https://www.gebco.net",
      coverage: { ocean: true },
      color: "#0066cc",
    },
  ];

  return NextResponse.json(
    { datasets, tileEndpoint: "/api/elevation-accuracy/{z}/{x}/{y}" },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=86400", // Static metadata, cache for 24h
      },
    },
  );
}
