import { NextRequest, NextResponse } from "next/server";
import { getElevation } from "@/lib/elevation";
import { getDefaultBackend } from "@/lib/storage/backend";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");

  if (!latStr || !lonStr) {
    return NextResponse.json(
      { error: "Missing required parameters: lat, lon" },
      { status: 400 },
    );
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon)) {
    return NextResponse.json(
      { error: "lat and lon must be valid numbers" },
      { status: 400 },
    );
  }

  try {
    const storage = getDefaultBackend();
    const result = await getElevation(lat, lon, storage);

    const response = NextResponse.json(result);

    // Cache elevation responses for 1 hour (data is static)
    response.headers.set("Cache-Control", "public, max-age=3600");
    response.headers.set("Access-Control-Allow-Origin", "*");

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
