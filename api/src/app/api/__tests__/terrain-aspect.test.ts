/**
 * Terrain routes — aspect direction bins and nodata handling.
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
  hostileTileData,
  resolveTile,
  aspectBody,
} from "./terrain-routes.harness";
import { GET as aspectGET } from "@/app/api/aspect/route";

// ── aspect ───────────────────────────────────────────────────────────────────
describe("Terrain routes — aspect direction bins", () => {
  it("classifies every compass octant from a directional gradient", async () => {
    // One request per planar gradient. Each 3×3 window resolves to a single
    // aspect value, so the eight gradients must cover the eight compass bins —
    // whichever way the route maps grid axes onto compass directions.
    const gradients: Array<[number, number]> = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    const seen = new Set<string>();
    for (const [gx, gy] of gradients) {
      const plane = buildTile((row, col) => 500 + gx * (col - 128) + gy * (row - 128));
      mockGetTileData.mockImplementation(resolveTile(plane));
      const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=1&zoom=10`));
      expect(resp.status).toBe(200);
      const body = await aspectBody(resp);
      expect(body.valid_cells).toBe(1);
      const hits = Object.entries(body.direction_bins ?? {})
        .filter(([, pct]) => pct === 100)
        .map(([dir]) => dir);
      expect(hits).toHaveLength(1);
      expect(hits[0]).not.toBe("flat");
      seen.add(hits[0]!); // bounds: length 1 asserted above
    }
    expect([...seen].sort()).toEqual(["E", "N", "NE", "NW", "S", "SE", "SW", "W"]);
  });

  it("points a north-rising slope's aspect south, not north", async () => {
    // Regression: atan2 negated the (already north-positive) dzDy a second
    // time, mirroring the compass across the E-W axis (N↔S swapped).
    // Rows run southward, so a value DEcreasing with row is a slope rising
    // northward — its downslope aspect must be S (and an east-rising slope,
    // value increasing with column, must face W).
    const risingNorth = buildTile((row) => 500 - (row - 128));
    mockGetTileData.mockImplementation(resolveTile(risingNorth));
    const northResp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=1&zoom=10`));
    expect((await aspectBody(northResp)).direction_bins?.["S"]).toBe(100);

    const risingEast = buildTile((_row, col) => 500 + (col - 128));
    mockGetTileData.mockImplementation(resolveTile(risingEast));
    const eastResp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=1&zoom=10`));
    expect((await aspectBody(eastResp)).direction_bins?.["W"]).toBe(100);
  });

  it("reports flat terrain under the flat bin instead of a compass direction", async () => {
    mockGetTileData.mockImplementation(resolveTile(buildTile(() => 500)));
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await aspectBody(resp);
    expect(body.valid_cells).toBe(9);
    expect(body.direction_bins?.["flat"]).toBe(100);
    // -1 reaches the emitted grid for interior cells, null for the border.
    expect(body.grid?.[1]?.[1]).toBe(-1);
    expect(body.grid?.[0]?.[0]).toBeNull();
  });

  it("downsamples the emitted grid as the radius grows", async () => {
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const mid = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=60&zoom=10`));
    const wide = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=120&zoom=10`));
    expect((await aspectBody(mid)).grid).toHaveLength(61); // 121 cells, step 2
    expect((await aspectBody(wide)).grid).toHaveLength(61); // 241 cells, step 4
  });
});

describe("Terrain routes — aspect nodata handling", () => {
  it("excludes cells with a nodata neighbour in their 3×3 window", async () => {
    const pour = pourPixel(40.7, -74.0);
    const holed = rampTile();
    // The single computed cell of a radius=1 window is the pixel at the pour
    // point; knock out its northern neighbour so the cell has no aspect.
    holed[(Math.floor(pour.ly) - 1) * 256 + Math.floor(pour.lx)] = -32768;
    mockGetTileData.mockImplementation(resolveTile(holed));
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=1&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await aspectBody(resp);
    expect(body.valid_cells).toBe(0);
    expect(body.direction_bins).toBeNull();
    expect(body.grid?.[1]?.[1]).toBeNull();
  });

  it("nulls cells whose four source pixels are all nodata", async () => {
    mockGetTileData.mockImplementation(resolveTile(nodataTile()));
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await aspectBody(resp);
    expect(body.valid_cells).toBe(0);
    expect(body.direction_bins).toBeNull();
    expect((body.grid ?? []).flat().every((v: number | null) => v === null)).toBe(true);
  });

  it("returns a 502 error body for non-numeric tile data", async () => {
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(502);
    const body = await aspectBody(resp);
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.grid).toBeUndefined();
  });

  it("reports an Unknown error with a 502 when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(502);
    const body = await aspectBody(resp);
    expect(body.error).toBe("Unknown error");
    expect(body.grid).toBeUndefined();
  });
});
