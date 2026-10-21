/**
 * Terrain routes — trace pour-point gate and flow-walk termination.
 *
 * Shared DEM mocks, gate state and body readers live in
 * `./terrain-routes.harness` — imported first so the mocks are registered
 * before the route modules below are evaluated.
 */

import { describe, it, expect } from "vitest";
import {
  explodingElevation,
  storageState,
  mockGetTileData,
  rampTile,
  nodataTile,
  pourPixel,
  serveOneTile,
  postJSON,
  POUR_NORTH_EDGE,
  POUR_NORTH_PROBE,
  POUR_EAST_EDGE,
  POUR_ISLAND,
  POUR_MID_TILE,
  islandTile,
  hostileTileData,
  resolveTile,
  traceBody,
} from "./terrain-routes.harness";
import { OPTIONS as traceOPTIONS, POST as tracePOST } from "@/app/api/trace/route";

// ── trace ────────────────────────────────────────────────────────────────────
// The trace walk is driven through single-tile DEMs so each termination branch
// (neighbour tile missing, walk leaves the window, sea level, nodata) can be
// reached deterministically.
describe("Terrain routes — trace pour-point gate", () => {
  it("returns 400 when no tile serves the pour point", async () => {
    mockGetTileData.mockRejectedValue(new Error("chunk missing"));
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(400);
    const body = await traceBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("falls back to the merged-chunk lookup when OZT2 throws", async () => {
    storageState.ozt2Rejects = true;
    storageState.pointElevation = "ok";
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(200);
    const body = await traceBody(resp);
    expect(body.geojson?.type).toBe("Feature");
    expect(body.steps).toBeGreaterThan(0);
  });

  it("returns 400 when neither OZT2 nor the merged fallback resolves the pour point", async () => {
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "null";
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(400);
    const body = await traceBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("returns 400 when the merged-chunk fallback throws as well", async () => {
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "throw";
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(400);
    const body = await traceBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("proceeds to tile assembly when the pour-point gate itself fails", async () => {
    // The gate's only unprotected statement is the `startElevVal <= NODATA`
    // comparison, so an elevation payload whose valueOf throws is the only way
    // in. The documented contract is to keep going regardless.
    storageState.ozt2Elevation = explodingElevation();
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(200);
    const body = await traceBody(resp);
    expect(body.geojson?.type).toBe("Feature");
    expect(body.steps).toBeGreaterThan(0);
  });

  it("exposes CORS preflight OPTIONS", async () => {
    const resp = await Promise.resolve(traceOPTIONS());
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("Terrain routes — trace flow-walk termination", () => {
  it("stops when the walk steps off the served tile window", async () => {
    const pour = pourPixel(POUR_NORTH_EDGE.lat, POUR_NORTH_EDGE.lon);
    // The DEM rises southward, so all three northern neighbours drop equally
    // and the first of them (north-east) wins. That diagonal step overshoots
    // the one-cell neighbour D8 validated, so the sampled point falls in the
    // unserved tile to the north and the move is discarded.
    serveOneTile(pour.tx, pour.ty, (row) => 500 + row);
    const resp = await postJSON(tracePOST, POUR_NORTH_EDGE);
    expect(resp.status).toBe(200);
    const body = await traceBody(resp);
    // No cell was recorded, but the abortive move still shows up in `end`.
    expect(body.steps).toBe(0);
    expect(body.path).toHaveLength(1);
    expect(body.elevations).toHaveLength(1);
    expect(body.end?.[0]).not.toBe(body.start?.[0]);
    expect(body.end?.[1]).not.toBe(body.start?.[1]);
    expect(body.geojson?.geometry?.coordinates).toHaveLength(1);
  });

  it("aborts before stepping when every downhill probe leaves the served tile", async () => {
    const pour = pourPixel(POUR_NORTH_PROBE.lat, POUR_NORTH_PROBE.lon);
    // Less than one probe step below the north edge: the three northern
    // neighbour lookups land in the unserved tile and are skipped, while the
    // five southern/sideways ones are flat or uphill against the southward
    // rise. With no admissible descent the walk never takes a step at all.
    serveOneTile(pour.tx, pour.ty, (row) => 500 + row);
    const resp = await postJSON(tracePOST, POUR_NORTH_PROBE);
    expect(resp.status).toBe(200);
    const body = await traceBody(resp);
    expect(body.start_elev).toBeGreaterThan(0);
    expect(body.steps).toBe(0);
    expect(body.path).toHaveLength(1);
    expect(body.end).toEqual(body.start);
  });

  it("stops when the next downstream neighbour tile is missing", async () => {
    const pour = pourPixel(POUR_EAST_EDGE.lat, POUR_EAST_EDGE.lon);
    // The DEM falls eastward, so the walk heads due east until the next cell
    // lies in the unserved tile to the east: the neighbour lookup misses, no
    // descent remains and the walk stops well short of max_steps.
    serveOneTile(pour.tx, pour.ty, (_row, col) => 500 - col);
    const resp = await postJSON(tracePOST, POUR_EAST_EDGE);
    expect(resp.status).toBe(200);
    const body = await traceBody(resp);
    expect(body.steps).toBeGreaterThan(3);
    expect(body.steps).toBeLessThan(50);
    const steps = body.steps ?? 0;
    expect(body.path).toHaveLength(steps + 1);
    // It stopped at the tile edge, not in a nodata cell or at sea level.
    expect(body.end_elev).toBeGreaterThan(0);
  });

  it("halts the walk when it reaches sea level", async () => {
    const pour = pourPixel(POUR_MID_TILE.lat, POUR_MID_TILE.lon);
    // 2 m per pixel eastward drop from 400 m: the walk runs due east from
    // mid-tile and stops on the first cell at or below 0 m.
    serveOneTile(pour.tx, pour.ty, (_row, col) => 400 - 2 * col);
    const resp = await postJSON(tracePOST, POUR_MID_TILE);
    expect(resp.status).toBe(200);
    const body = await traceBody(resp);
    expect(body.elevations?.[0]).toBeGreaterThan(0);
    expect(body.steps).toBeGreaterThan(10);
    expect(body.end_elev).toBeLessThanOrEqual(0);
    expect(body.total_distance).toBeGreaterThan(0);
    expect(body.geojson?.properties?.steps).toBe(body.steps);
  });

  it("cannot descend out of a tile with a single live pixel", async () => {
    // One live pixel in an otherwise nodata tile: the pour point still reads
    // (its stencil keeps that corner) but three quarters of its stencil is
    // nodata, half the neighbour lookups are skipped wholesale, and the walk
    // runs out of elevation within a couple of cells.
    mockGetTileData.mockImplementation(resolveTile(islandTile()));
    const resp = await postJSON(tracePOST, POUR_ISLAND);
    expect(resp.status).toBe(200);
    const body = await traceBody(resp);
    expect(body.start_elev).toBeGreaterThan(-32768);
    expect(body.steps).toBeGreaterThanOrEqual(1);
    expect(body.steps).toBeLessThanOrEqual(4);
    expect(body.elevations).toHaveLength(body.path?.length ?? 0);
  });

  it("rejects a pour point whose sampled stencil is entirely nodata", async () => {
    mockGetTileData.mockImplementation(resolveTile(nodataTile()));
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(400);
    const body = await traceBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
    // A client asking for a lake-less coordinate gets a real 400 rather than a
    // degraded payload.
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
  });

  it("returns a 502 error body for non-numeric tile data", async () => {
    // A bigint tile payload explodes the first time it reaches the bilinear
    // mix — that is the only route into the handler's catch, which reports the
    // failure as a 502 with the thrown message.
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(502);
    const body = await traceBody(resp);
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.geojson).toBeUndefined();
  });

  it("reports an Unknown error with a 502 when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(502);
    const body = await traceBody(resp);
    expect(body.error).toBe("Unknown error");
    expect(body.geojson).toBeUndefined();
  });
});
