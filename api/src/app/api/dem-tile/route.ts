import { NextResponse } from "next/server";

/**
 * DEM terrain provider metadata endpoint.
 *
 * Serves the layer.json required by CesiumJS CesiumTerrainProvider.
 * Also works with MapLibre raster-dem sources.
 *
 * CesiumJS usage:
 *   new Cesium.CesiumTerrainProvider({ url: "/api/dem-tile" })
 *
 * MapLibre usage:
 *   map.addSource("dem", {
 *     type: "raster-dem",
 *     tiles: ["/api/dem-tile/{z}/{x}/{y}"],
 *     tileSize: 256,
 *     encoding: "terrarium",
 *   });
 */

export const runtime = "edge";

const TERRAIN_METADATA = {
  tilejson: "3.0.0" as const,
  tiles: ["/api/dem-tile/{z}/{x}/{y}"],
  minzoom: 0,
  maxzoom: 12,
  bounds: [-180, -90, 180, 90],
  center: [0, 0, 4],
  encoding: "terrarium" as const,
  // CesiumJS extension fields
  format: "terrarium",
  tileFormat: "terrarium",
  available: true,
  version: "1.0.0",
  name: "OpenZenith Global DEM",
  description: "Merged Copernicus GLO-30 + GEBCO 2025 terrain",
  attribution: "Copernicus DEM, GEBCO 2025",
  scheme: "xyz",
};

export async function GET() {
  return NextResponse.json(TERRAIN_METADATA, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json",
    },
  });
}
