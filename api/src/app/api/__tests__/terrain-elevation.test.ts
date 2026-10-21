/**
 * Terrain routes — slope and profile elevation arms.
 *
 * Shared DEM mocks, gate state and body readers live in
 * `./terrain-routes.harness` — imported first so the mocks are registered
 * before the route modules below are evaluated.
 */

import { describe, it, expect } from "vitest";
import {
  mockGetTileData,
  GET_URL,
  makeRequest,
  buildTile,
  rampTile,
  nodataTile,
  pourPixel,
  postJSON,
  hostileTileData,
  resolveTile,
  slopeBody,
  profileBody,
} from "./terrain-routes.harness";
import { OPTIONS as PROFILE_OPTIONS, POST as profilePOST } from "@/app/api/profile/route";
import { GET as slopeGET } from "@/app/api/slope/route";

describe("Terrain routes — slope nodata and downsampling arms", () => {
  it("marks a cell with a nodata neighbour NaN and leaves an even valid count", async () => {
    // radius=2 samples a 5×5 grid whose top-left cell is the tile pixel at
    // (floor(lx)-2, floor(ly)-2). Punch nodata there: the dem cell reads
    // exactly nodata (fx=fy=0), the interior cell beside it loses its 3×3
    // window, and the remaining 8 valid cells exercise the even-count median.
    const pour = pourPixel(40.7, -74.0);
    const holeRow = Math.floor(pour.ly) - 2;
    const holeCol = Math.floor(pour.lx) - 2;
    const holed = rampTile();
    holed[holeRow * 256 + holeCol] = -32768;
    mockGetTileData.mockImplementation(resolveTile(holed));

    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await slopeBody(resp);
    expect(body.stats).not.toBeNull();
    expect(body.stats?.count).toBe(8); // 3×3 interior minus the holed neighbour
    expect((body.stats?.count ?? 0) % 2).toBe(0);
    expect(body.grid?.[1]?.[1]).toBeNull(); // the cell whose window hit the hole
  });

  it("emits an all-null grid and null stats when the served tile is all nodata", async () => {
    // Every dem cell reads four nodata corners, so the all-corners guard fires
    // for each cell and computeSlope has nothing valid to summarise.
    mockGetTileData.mockImplementation(resolveTile(nodataTile()));
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await slopeBody(resp);
    expect(body.stats).toBeNull();
    expect((body.grid ?? []).flat().every((v) => v === null)).toBe(true);
  });

  it("downsamples the emitted grid as the radius grows", async () => {
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const mid = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=60&zoom=10`));
    const wide = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=120&zoom=10`));
    expect((await slopeBody(mid)).grid).toHaveLength(61); // 121 rows, step 2
    expect((await slopeBody(wide)).grid).toHaveLength(61); // 241 rows, step 4
  });

  it("returns a 502 error body for non-numeric tile data", async () => {
    // BigInt pixel reads explode inside bilinear assembly — the route's outer
    // catch reports the failure as a 502 with the error message.
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(502);
    const body = await slopeBody(resp);
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.grid).toBeUndefined();
  });

  it("reports an Unknown error with a 502 when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(502);
    const body = await slopeBody(resp);
    expect(body.error).toBe("Unknown error");
    expect(body.grid).toBeUndefined();
  });
});

// ── profile — preflight, nodata transects and the gain-reduce fallback ───────
describe("Terrain routes — profile emission arms", () => {
  it("exposes CORS preflight OPTIONS", async () => {
    const resp = await Promise.resolve(PROFILE_OPTIONS());
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("reports raw nodata values when the transect crosses an all-nodata tile", async () => {
    // All four corners nodata at every sample: the transect keeps -32768
    // (not rounded, not dropped) and the stats come back null.
    mockGetTileData.mockImplementation(resolveTile(nodataTile()));
    const resp = await postJSON(profilePOST, { lat1: 40.7, lon1: -74.0, lat2: 40.75, lon2: -73.95 });
    expect(resp.status).toBe(200);
    const body = await profileBody(resp);
    expect(body.stats).toBeNull();
    expect((body.profile ?? []).every((p) => p.elevation === -32768)).toBe(true);
  });

  it("sums a non-contiguous rise via the gain reduce's missing-predecessor fallback", async () => {
    // Three sample points ~24 px apart in tile-local rows (z10). Plateaus at
    // 600 -> 300 -> 900 leave exactly one gain, at profile index 2, so
    // total_gain must report the single 300 -> 900 rise. (Regression: the
    // reduce once indexed its filtered array instead of `profile`, which
    // aliased the point itself and netted every gain to zero.)
    const rowOf = (lat: number): number => Math.floor(pourPixel(lat, -74.0).ly);
    const r0 = rowOf(40.6);
    const r1 = rowOf(40.575);
    const bands = (row: number) => (row <= r0 + 1 ? 600 : row <= r1 + 1 ? 300 : 900);
    mockGetTileData.mockImplementation(resolveTile(buildTile(bands)));

    const resp = await postJSON(profilePOST, {
      lat1: 40.6,
      lon1: -74.0,
      lat2: 40.55,
      lon2: -74.0,
      num_points: 3,
    });
    expect(resp.status).toBe(200);
    const body = await profileBody(resp);
    expect(body.num_points).toBe(3);
    expect((body.profile ?? []).map((p) => p.elevation)).toEqual([600, 300, 900]);
    expect(body.stats).toMatchObject({ min: 300, max: 900, total_gain: 600 });
  });

  it("returns a 502 error body for non-numeric tile data", async () => {
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await postJSON(profilePOST, { lat1: 40.7, lon1: -74.0, lat2: 40.75, lon2: -73.95 });
    expect(resp.status).toBe(502);
    const body = await profileBody(resp);
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.profile).toBeUndefined();
  });

  it("reports an Unknown error with a 502 when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await postJSON(profilePOST, { lat1: 40.7, lon1: -74.0, lat2: 40.75, lon2: -73.95 });
    expect(resp.status).toBe(502);
    const body = await profileBody(resp);
    expect(body.error).toBe("Unknown error");
    expect(body.profile).toBeUndefined();
  });
});
