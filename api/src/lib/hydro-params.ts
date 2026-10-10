/**
 * Shared request prologue for the hydrology POST endpoints
 * (`/api/twi`, `/api/streams`, `/api/watershed`).
 *
 * The three routes opened with the same four-step sequence — JSON parse,
 * lat/lon presence, coordinate validity, radius clamp — followed by the same
 * start-elevation gate. The steps live here (cycle V, C3), joined in cycle VI
 * (D2) by {@link openHydroGrid}, which chains them into the assembled DEM
 * grid each route previously destructured from its own `assembleTerrainGrid`
 * call. Each route keeps only its HTTP response shaping and the body field
 * unique to it (streams' `threshold`). Defaults and clamp bounds are verbatim
 * from the routes: zoom 10, radius 100 clamped to [10, 200].
 *
 * Mirrors the `elevation-params.ts` result convention: parse failure carries
 * the message; each route wraps it in its own response shape.
 */

import { assembleTerrainGrid, resolveStartElevation } from "./terrain-grid";
import type { TerrainGrid } from "./terrain-grid";
import { TERRAIN_NODATA } from "./terrain-grid";

/** POST body of the hydrology family. Required fields are validated explicitly. */
export interface HydroRequestBody {
  lat?: number;
  lon?: number;
  zoom?: number;
  radius_cells?: number;
  threshold?: number;
}

/** Discriminated result of {@link parseHydroPrologue}: fields on ok, message on failure. */
export type HydroPrologue =
  | { ok: true; lat: number; lon: number; zoom: number; radius: number; threshold: number | undefined }
  | { ok: false; message: string };

/** Parse and validate the shared body fields; `threshold` passes through raw (streams-only). */
export function parseHydroPrologue(body: HydroRequestBody): HydroPrologue {
  const { lat, lon, zoom = 10, radius_cells = 100, threshold } = body;

  if (typeof lat !== "number" || typeof lon !== "number") {
    return { ok: false, message: "lat and lon are required" };
  }
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, message: "Invalid coordinates" };
  }

  const radius = Math.min(200, Math.max(10, radius_cells));
  return { ok: true, lat, lon, zoom, radius, threshold };
}

/**
 * Start-elevation gate: resolves the point through OZT2 (primary) then merged
 * chunks (fallback). Returns ok:false only when the point provably has no
 * data; a resolver throw proceeds (the tile-loading stage catches missing
 * data), exactly as the inline try/catch did in the routes.
 */
export async function gateStartElevation(
  lat: number,
  lon: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const startElevVal = await resolveStartElevation(lat, lon);
    if (startElevVal === null || startElevVal <= TERRAIN_NODATA) {
      return { ok: false, message: "No elevation data at starting point" };
    }
  } catch {
    // Proceed — tile loading will catch missing data
  }
  return { ok: true };
}

/** Discriminated result of {@link openHydroGrid}: context on ok, message on failure. */
export type HydroGridResult =
  | ({ ok: true; grid: TerrainGrid } & Extract<HydroPrologue, { ok: true }>)
  | { ok: false; message: string };

/**
 * The trio's full opener (cycle VI, D2): parse/validate → start-elevation
 * gate → assembled DEM grid, replacing the identical parse-check, gate-check
 * and `assembleTerrainGrid` destructure each route carried. Callers keep the
 * HTTP shaping: a `!ok` result becomes their 400 body, and a throw from the
 * grid assembly still reaches the route's own catch (the hostile-DEM 502
 * fixtures depend on that), so call this inside the route's try block.
 */
export async function openHydroGrid(body: HydroRequestBody): Promise<HydroGridResult> {
  const prologue = parseHydroPrologue(body);
  if (!prologue.ok) return prologue;
  const gate = await gateStartElevation(prologue.lat, prologue.lon);
  if (!gate.ok) return gate;
  const grid = await assembleTerrainGrid({
    lat: prologue.lat,
    lon: prologue.lon,
    radius: prologue.radius,
    zoom: prologue.zoom,
  });
  return { ...prologue, grid };
}
