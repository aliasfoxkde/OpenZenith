/**
 * Client elevation — the batched lookup.
 *
 * The DEM fixtures, the fetch router and the `afterEach` global-stub reset
 * live in `./client-elevation.harness` — imported first so the stub is in place.
 */

import { describe, it, expect } from "vitest";
import {
  NODATA,
  chunkPayload,
  installFixtures,
  jsonResponse,
  mergedFile,
  mergedWithLinearChunk0,
  slot,
  stripFor,
} from "./client-elevation.harness";
import { getClientElevation,
  getClientElevationBatch } from "../client-elevation";

describe("getClientElevationBatch", () => {
  it("resolves SRTM points, GEBCO points and nulls in input order", async () => {
    // chunk (0,0) holds 700 + row + col; chunk (7,7) is absent -> nodata -> GEBCO
    installFixtures({
      merged: {
        N44W074: mergedFile([{ slot: slot(0, 0), data: chunkPayload((r, c) => 700 + r + c, 256, 256) }], 15, 15),
      },
      strips: {
        // point (70, 10): row (90-70)*240 = 4800, col (10-0)*240 = 2400
        "gebco_2025_n90.0_s0.0_w0.0_e90.0.tif": stripFor(2400, -1500),
        // point (-45, 100): row (0+45)*240 = 10800, col (100-90)*240 = 2400 -> impossible value
        "gebco_2025_n0.0_s-90.0_w90.0_e180.0.tif": stripFor(2400, 20000),
        // point (44.5, -73.5): row (90-44.5)*240 = 10920, col (-73.5+90)*240 = 3960
        "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3960, -2500),
      },
    });

    const results = await getClientElevationBatch([
      { lat: 44.99, lon: -73.99, id: "a" }, // SRTM chunk (0,0) local (36,36)
      { lat: 44.95, lon: -73.95, id: "b" }, // SRTM chunk (0,0) local (180,180)
      { lat: 70, lon: 10, id: "ocean" }, // outside SRTM -> GEBCO
      { lat: -45, lon: 100, id: "no-data" }, // outside SRTM -> GEBCO nodata -> null
      { lat: 44.5, lon: -73.5, id: "missing-chunk" }, // SRTM chunk missing -> GEBCO
    ]);

    expect(results).toHaveLength(5);
    // Results are rebuilt from the caller's request fields: no internal `idx`
    // bookkeeping key, and the requested (non-normalised) longitude.
    expect(results[0]).toEqual({ lat: 44.99, lon: -73.99, id: "a", elevation: 772 });
    expect(results[1]).toEqual({ lat: 44.95, lon: -73.95, id: "b", elevation: 1060 });
    expect(results[2]).toEqual({ lat: 70, lon: 10, id: "ocean", elevation: -1500 });
    expect(results[3]).toEqual({ lat: -45, lon: 100, id: "no-data", elevation: null });
    expect(results[4]).toEqual({ lat: 44.5, lon: -73.5, id: "missing-chunk", elevation: -2500 });
  });

  it("normalises longitudes for every point before grouping tiles", async () => {
    installFixtures({
      merged: { N41W074: mergedWithLinearChunk0() },
    });

    // 286.05 - 360 = -73.95 -> same tile and pixel as the canonical longitude.
    const results = await getClientElevationBatch([{ lat: 41.95, lon: 286.05, id: "wrapped" }]);
    expect(results[0]?.elevation).toBe(460);
    // The elevation is resolved via the normalised longitude, but the caller
    // gets their requested longitude back untouched.
    expect(results[0]?.lon).toBe(286.05);
  });

  it("falls back to POST /api/elevation/batch when the merged index is unusable", async () => {
    const { calls } = installFixtures({
      // rows=1/cols=1 index cannot satisfy chunk (7,7) -> the client batch throws
      merged: { N45W074: mergedFile([], 1, 1) },
      batchEndpoint: () =>
        jsonResponse({
          results: [
            { lat: 45.5, lon: -73.5, elevation: 11 },
            { lat: 45.6, lon: -73.6, elevation: 22 },
          ],
        }),
    });

    const results = await getClientElevationBatch([
      { lat: 45.5, lon: -73.5, id: "x" },
      { lat: 45.6, lon: -73.6 },
    ]);

    // The caller's `id` fields are re-attached even though the server payload
    // omits them.
    expect(results).toEqual([
      { lat: 45.5, lon: -73.5, id: "x", elevation: 11 },
      { lat: 45.6, lon: -73.6, elevation: 22 },
    ]);
    expect(calls.at(-1)?.url).toBe("/api/elevation/batch");
    expect(calls.at(-1)?.range).toBeNull();
  });

  it("returns null elevations when the server batch endpoint errors", async () => {
    installFixtures({
      merged: { N45W074: mergedFile([], 1, 1) },
      batchEndpoint: () => jsonResponse({ error: "boom" }, 500),
    });

    const results = await getClientElevationBatch([{ lat: 45.5, lon: -73.5, id: "x" }]);
    expect(results).toEqual([{ lat: 45.5, lon: -73.5, id: "x", elevation: null }]);
  });

  it("returns null elevations when the server batch response has no results", async () => {
    installFixtures({
      merged: { N45W074: mergedFile([], 1, 1) },
      batchEndpoint: () => jsonResponse({ ok: true }),
    });

    const results = await getClientElevationBatch([{ lat: 45.5, lon: -73.5, id: "x" }]);
    expect(results).toEqual([{ lat: 45.5, lon: -73.5, id: "x", elevation: null }]);
  });

  it("returns null elevations when the server batch endpoint rejects", async () => {
    installFixtures({
      merged: { N45W074: mergedFile([], 1, 1) },
      batchEndpoint: () => {
        throw new TypeError("fetch failed");
      },
    });

    const results = await getClientElevationBatch([{ lat: 45.5, lon: -73.5, id: "x" }]);
    expect(results).toEqual([{ lat: 45.5, lon: -73.5, id: "x", elevation: null }]);
  });

  it("never leaks caller ids when the server returns more results than points", async () => {
    installFixtures({
      merged: { N45W074: mergedFile([], 1, 1) },
      batchEndpoint: () => jsonResponse({ results: [{ elevation: 11 }, { elevation: 22 }] }), // one extra result
    });

    const results = await getClientElevationBatch([{ lat: 45.5, lon: -73.5, id: "x" }]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ lat: 45.5, lon: -73.5, id: "x", elevation: 11 });
    // The surplus result has no caller point; its lat/lon must be NaN, not a
    // stale id or a fabricated coordinate.
    expect(Number.isNaN(results[1]!.lat)).toBe(true);
    expect(Number.isNaN(results[1]!.lon)).toBe(true);
    expect(results[1]!.id).toBeUndefined();
  });

  it("falls back to GEBCO from inside a tile group when the SRTM pixel is nodata", async () => {
    installFixtures({
      // the point lands in chunk (0,0), which decodes to pure nodata
      merged: { N43W074: mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => NODATA, 256, 256) }], 15, 15) },
      // point (43.95, -73.95): row (90 - 43.95) * 240 = 11052, col (90 - 73.95) * 240 = 3852
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": stripFor(3852, -1800) },
    });

    const results = await getClientElevationBatch([{ lat: 43.95, lon: -73.95, id: "sea" }]);

    expect(results[0]).toEqual({ lat: 43.95, lon: -73.95, id: "sea", elevation: -1800 });
  });

  it("drops a tile-group point whose GEBCO fallback is also unavailable", async () => {
    // SRTM pixel is nodata AND the CEDA strip request errors: clientGebcoElevation
    // returns null, so the point gets no result entry at all (not a zero).
    installFixtures({
      merged: { N42W074: mergedFile([{ slot: slot(0, 0), data: chunkPayload(() => NODATA, 256, 256) }], 15, 15) },
      strips: { "gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif": 503 },
    });

    const results = await getClientElevationBatch([{ lat: 42.95, lon: -73.95, id: "dry" }]);

    expect(results).toEqual([{ lat: 42.95, lon: -73.95, id: "dry", elevation: null }]);
  });

  it("reads two points in the same chunk with a single decode (chunkCache hit)", async () => {
    // Both points land in chunk (0,0) of the same cell: the assembly loop
    // requests the chunk once, and the second point takes the chunkCache-hit
    // arm of the has() guard.
    const { calls } = installFixtures({
      merged: { N41W074: mergedWithLinearChunk0() },
    });

    const results = await getClientElevationBatch([
      { lat: 41.95, lon: -73.95, id: "one" },
      { lat: 41.96, lon: -73.96, id: "two" },
    ]);

    expect(results.map((r) => r.elevation)).toEqual([460, 388]);
    expect(calls.filter((c) => c.url.includes("N41W074.merged")).length).toBeLessThanOrEqual(2);
  });

  it("evicts the oldest chunk and merged entries once the caches overflow", async () => {
    // Any requested tile is served a merged file whose entire chunk row 7 —
    // the chunk row holding latitude 41.5 — is flat 500.
    const flatRow7 = mergedFile(
      Array.from({ length: 15 }, (_, cc) => ({
        slot: slot(7, cc),
        data: chunkPayload(() => 500, 256, 256),
      })),
      15,
      15,
    );
    const { calls } = installFixtures({ mergedFor: () => flatRow7 });

    // 70 points, each in its own SRTM degree -> 70 merged files / 70 chunks,
    // which overflows both 64 entry caches
    const points = Array.from({ length: 70 }, (_, i) => ({ lat: 41.5, lon: -72 + i, id: `p${i}` }));
    const results = await getClientElevationBatch(points);

    expect(results).toHaveLength(70);
    expect(results.every((r) => r.elevation === 500)).toBe(true);

    const fetchesFor = (tile: string) => calls.filter((c) => c.url.includes(`/${tile}.merged`)).length;
    expect(fetchesFor("N41W072")).toBe(1);
    // the first tile has fallen out of both caches, so it is fetched again
    await getClientElevation(points[0]!.lat, points[0]!.lon);
    expect(fetchesFor("N41W072")).toBe(2);
    // the most recent tile is still cached
    await getClientElevation(points[69]!.lat, points[69]!.lon);
    expect(fetchesFor("N41W003")).toBe(1);
  });
});
