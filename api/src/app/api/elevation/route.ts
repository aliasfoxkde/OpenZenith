import { NextRequest, NextResponse } from "next/server";
import { getElevation } from "@/lib/elevation";
import { getDefaultBackend } from "@/lib/storage/backend";
import { getCopernicusElevation } from "@/lib/copernicus/cog-reader";
import { getGebcoElevation } from "@/lib/gebco/cog-reader";
import { isWithinSRTM } from "@/lib/srtm/tile-math";

export const runtime = "edge";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");
  const dataset = searchParams.get("dataset") || "auto";

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

  const validDatasets = ["auto", "srtm30m", "copernicus-glo30", "gebco2025"];
  if (!validDatasets.includes(dataset)) {
    return NextResponse.json(
      { error: `Invalid dataset. Must be one of: ${validDatasets.join(", ")}` },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let result: any;

    if (dataset === "gebco2025") {
      // Force GEBCO (ocean bathymetry + coastal/ice)
      result = await getGebcoElevation(lat, lon);
    } else if (dataset === "copernicus-glo30") {
      // Force Copernicus
      result = await getCopernicusElevation(lat, lon);
    } else if (dataset === "srtm30m") {
      // Force SRTM
      const storage = getDefaultBackend();
      result = await getElevation(lat, lon, storage);
    } else {
      // Auto: SRTM (fast, cached) → Copernicus (global land) → GEBCO (ocean bathymetry)
      if (isWithinSRTM(lat, lon)) {
        const storage = getDefaultBackend();
        const srtmResult = await getElevation(lat, lon, storage);
        if (srtmResult.elevation !== null) {
          result = srtmResult;
        } else {
          // SRTM has no data (ocean/nodata) — try Copernicus, then GEBCO
          result = await getCopernicusElevation(lat, lon);
          if (result.elevation === null) {
            result = await getGebcoElevation(lat, lon);
          }
        }
      } else {
        // Outside SRTM coverage — try Copernicus, then GEBCO
        result = await getCopernicusElevation(lat, lon);
        if (result.elevation === null) {
          result = await getGebcoElevation(lat, lon);
        }
      }
    }

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
