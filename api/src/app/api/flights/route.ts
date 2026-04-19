import { NextRequest, NextResponse } from "next/server";
import { cachedFetch, CACHE_TTL } from "@/lib/cache";
import { CORS_HEADERS, corsError, corsPreflightResponse } from "@/lib/cors";

export const runtime = "edge";

export async function OPTIONS() {
  return corsPreflightResponse();
}

/**
 * OpenSky returns ~20k flights as a full-state vector per aircraft.
 * The response is ~6MB which can exceed edge worker limits.
 *
 * Strategy:
 * - With bbox: pass through to OpenSky (smaller response, ~1-3MB)
 * - Without bbox: request from OpenSky but strip heavy fields (callsign,
 *   velocity vectors, sensors) and return only position + basic info.
 *   This reduces response from ~6MB to ~1MB.
 * - Server-side cache: 120s TTL — OpenSky is slow from CF edge (~10-15s)
 * - 20s fetch timeout to accommodate CF edge latency
 * - With bbox: smaller response, much more likely to succeed
 */

function parseBboxParam(val: string | null, min: number, max: number): number | null {
  if (!val) return null;
  const n = Number(val);
  return isNaN(n) || n < min || n > max ? null : n;
}

interface OpenSkyState {
  // Index 0: icao24, 1: callsign, 2: origin_country, 3: time_position,
  // 4: last_contact, 5: longitude, 6: latitude, 7: baro_altitude,
  // 8: on_ground, 9: velocity, 10: true_track, 11: vertical_rate,
  // 12: sensors, 13: geo_altitude, 14: squawk, 15: spi, 16: position_source
  [key: number]: unknown;
}

function slimState(state: OpenSkyState): Record<string, unknown> {
  return {
    icao24: state[0],
    callsign: typeof state[1] === "string" ? state[1].trim() : null,
    origin_country: state[2],
    longitude: state[5],
    latitude: state[6],
    baro_altitude: state[7],
    on_ground: state[8],
    velocity: state[9],
    true_track: state[10],
    vertical_rate: state[11],
    squawk: state[14],
    position_source: state[16],
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate bbox params
  const lamin = parseBboxParam(searchParams.get("lamin"), -90, 90);
  const lamax = parseBboxParam(searchParams.get("lamax"), -90, 90);
  const lomin = parseBboxParam(searchParams.get("lomin"), -180, 180);
  const lomax = parseBboxParam(searchParams.get("lomax"), -180, 180);

  const hasAny = [lamin, lamax, lomin, lomax].some((v) => v !== null);
  const allValid = lamin !== null && lamax !== null && lomin !== null && lomax !== null;
  if (hasAny && !allValid) {
    return corsError("Invalid bbox params: lamin, lamax (-90 to 90), lomin, lomax (-180 to 180) required", 400);
  }

  // Build OpenSky URL — always request all states (bbox filtering is on our side
  // to reduce response size, but OpenSky's bbox param also helps upstream)
  const url = new URL("https://opensky-network.org/api/states/all");
  if (allValid) {
    url.searchParams.set("lamin", String(lamin));
    url.searchParams.set("lamax", String(lamax));
    url.searchParams.set("lomin", String(lomin));
    url.searchParams.set("lomax", String(lomax));
  }
  if (searchParams.has("bbox")) {
    url.searchParams.set("bbox", searchParams.get("bbox")!);
  }

  try {
    const resp = await cachedFetch(url.toString(), CACHE_TTL.FLIGHTS, {
      signal: AbortSignal.timeout(20000),
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      return NextResponse.json(
        { time: Math.floor(Date.now() / 1000), states: [], error: `OpenSky API returned ${resp.status}` },
        { status: 200, headers: CORS_HEADERS },
      );
    }

    const data = (await resp.json()) as { time: number; states: OpenSkyState[] };

    // If bbox provided, OpenSky already filtered — return as-is (slimmed)
    // If no bbox, slim the response to reduce payload from ~6MB to ~1MB
    const states = data.states || [];
    const slimmed = allValid ? states.map(slimState) : states.map(slimState);

    const headers = new Headers(CORS_HEADERS);
    headers.set("Cache-Control", "public, max-age=60");
    headers.set("Content-Type", "application/json");

    return new Response(JSON.stringify({ time: data.time, states: slimmed }), {
      status: 200,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Flight data fetch failed";
    // Return empty result instead of 502 so the map doesn't break
    return NextResponse.json(
      { time: Math.floor(Date.now() / 1000), states: [], error: message },
      { status: 200, headers: CORS_HEADERS },
    );
  }
}
