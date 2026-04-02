import { NextRequest, NextResponse } from "next/server";
import { getTileData } from "@/lib/tile";
import { HuggingFaceChunkBackend } from "@/lib/storage/backend";

export const runtime = "edge";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Direct HuggingFace backend — avoids process.env which may not work on edge
const HF_BACKEND = new HuggingFaceChunkBackend("aliasfox/srtm30m-merged", true);

function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

async function getElevation(lat: number, lon: number) {
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
        surface_type: (elevation < 0 ? "ocean" : "land") as "land" | "ocean" | "unknown",
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

  return {
    elevation: null,
    surface_type: "unknown" as const,
    unit: "meters",
    location: { lat, lon },
    source: "none",
    tile: "",
    resolution: 1700,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");

  if (!latStr || !lonStr) {
    return NextResponse.json(
      { error: "Missing required parameters: lat, lon" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json(
      { error: "Invalid coordinates. lat must be -90..90, lon must be -180..180" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const result = await getElevation(lat, lon);

    return NextResponse.json(result, {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
