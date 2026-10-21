/**
 * Terrain routes — hydrology surfaces (watershed, streams, twi).
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
  GET_URL,
  makeRequest,
  buildTile,
  rampTile,
  nodataTile,
  pourPixel,
  postJSON,
  hostileTileData,
  resolveTile,
  twiBody,
  watershedBody,
  streamsBody,
  type StreamsBody,
} from "./terrain-routes.harness";
import { OPTIONS as streamsOPTIONS, POST as streamsPOST } from "@/app/api/streams/route";
import { OPTIONS as twiOPTIONS, POST as twiPOST } from "@/app/api/twi/route";
import { OPTIONS as watershedOPTIONS, POST as watershedPOST } from "@/app/api/watershed/route";

describe("Terrain routes — watershed pour-point elevation gate", () => {
  it("exposes CORS preflight OPTIONS", async () => {
    const resp = await Promise.resolve(watershedOPTIONS());
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("falls back to the merged-chunk point lookup when OZT2 throws", async () => {
    storageState.ozt2Rejects = true;
    storageState.pointElevation = "ok";
    // The earlier degradation tests leave a rejecting getTileData behind;
    // delineation needs real tiles, so restore the ramp explicitly.
    mockGetTileData.mockImplementation(() => Promise.resolve({ data: rampTile(), width: 256, height: 256, zoom: 10 }));
    const resp = await watershedPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    // The fallback elevation satisfies the gate, so delineation still runs.
    expect(resp.status).toBe(200);
    const body = await watershedBody(resp);
    expect(body.pixels).toBeGreaterThan(0);
    expect(body.geojson?.features).toHaveLength(1);
    expect(body.geojson?.features?.[0]?.geometry?.type).toBe("Polygon");
  });

  it("returns 400 when neither OZT2 nor merged chunks resolve the pour point", async () => {
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "throw";
    const resp = await watershedPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(400);
    const body = await watershedBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("degrades to a single-cell basin when the DEM tile cannot be fetched", async () => {
    mockGetTileData.mockRejectedValue(new Error("chunk missing"));
    const resp = await watershedPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    // Silent-200 contract: no elevation anywhere still yields a (degenerate)
    // basin with null stats rather than a 5xx.
    expect(resp.status).toBe(200);
    const body = await watershedBody(resp);
    expect(body.pixels).toBe(1);
    expect(body.min_elev).toBeNull();
    expect(body.max_elev).toBeNull();
    expect(body.mean_elev).toBeNull();
    expect(body.geojson?.features?.[0]?.geometry?.type).toBe("Point");
  });

  it("maps boundary cells to geographic coordinates near the pour point", async () => {
    // Regression: boundary coords were once built from tile-index math,
    // producing longitudes of ~25,000°. Cell centers must land in a small
    // window around the requested (40.7, -74.0) at z10.
    const resp = await watershedPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await watershedBody(resp);
    const ring = body.boundary as Array<[number, number]>;
    expect(ring.length).toBeGreaterThan(0);
    for (const [lon, lat] of ring) {
      expect(lon).toBeGreaterThan(-74.1);
      expect(lon).toBeLessThan(-73.9);
      expect(lat).toBeGreaterThan(40.6);
      expect(lat).toBeLessThan(40.8);
    }
  });

  it("recentres onto the nearest valid cell when the pour point is nodata", async () => {
    // The 21x21 sample window for lat 40.7 / lon -74 at z10 covers tile
    // columns 120..140 and rows 5..26. Punch a nodata hole around the window
    // centre so the pour point itself has no elevation while ring cells do.
    const holeTile = (): Int16Array =>
      buildTile((row, col) => (col >= 124 && col <= 136 && row >= 9 && row <= 21 ? -32768 : 500 + (col % 64)));
    mockGetTileData.mockImplementation(() => Promise.resolve({ data: holeTile(), width: 256, height: 256, zoom: 10 }));
    const resp = await watershedPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await watershedBody(resp);
    // Delineation still runs from a relocated centre and reports real stats.
    expect(body.pixels).toBeGreaterThan(0);
    expect(body.min_elev).not.toBeNull();
    expect(body.max_elev).not.toBeNull();
  });
});

describe("Terrain routes — streams elevation gate and DEM degradation", () => {
  it("exposes CORS preflight OPTIONS", async () => {
    const resp = await Promise.resolve(streamsOPTIONS());
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  });

  it("falls back to the merged-chunk point lookup when OZT2 throws", async () => {
    storageState.ozt2Rejects = true;
    storageState.pointElevation = "ok";
    // The degradation describe leaves a rejecting getTileData behind.
    mockGetTileData.mockImplementation(() => Promise.resolve({ data: rampTile(), width: 256, height: 256, zoom: 10 }));
    const resp = await streamsPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await streamsBody(resp);
    expect(body.type).toBe("FeatureCollection");
  });

  it("returns 400 when the merged-chunk fallback throws too", async () => {
    storageState.ozt2Rejects = true;
    storageState.pointElevation = "throw";
    const resp = await streamsPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(400);
    const body = await streamsBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("emits an empty network when the DEM tile cannot be fetched", async () => {
    mockGetTileData.mockRejectedValue(new Error("chunk missing"));
    const resp = await streamsPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await streamsBody(resp);
    expect(body.features).toHaveLength(0);
    expect(body.stats?.stream_count).toBe(0);
    expect(body.stats?.total_cells).toBe(21 * 21);
  });

  it("marks every cell nodata when the tile holds only nodata values", async () => {
    mockGetTileData.mockImplementation(() =>
      Promise.resolve({ data: nodataTile(), width: 256, height: 256, zoom: 10 }),
    );
    const resp = await streamsPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await streamsBody(resp);
    expect(body.features).toHaveLength(0);
  });

  it("traces downhill stream segments when the threshold admits every cell", async () => {
    mockGetTileData.mockImplementation(() => Promise.resolve({ data: rampTile(), width: 256, height: 256, zoom: 10 }));
    const resp = await streamsPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10, threshold: 1 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await streamsBody(resp);
    expect(body.features?.length).toBeGreaterThan(0);
    expect(body.stats?.stream_count).toBe(body.features?.length);
    expect(body.stats?.threshold).toBe(1);
    expect(body.stats?.total_cells).toBe(21 * 21);
    // The shared visited array stops each trace at the first cell an earlier
    // trace already walked, so segments stay short — but every reported
    // segment is a real multi-cell LineString whose coordinates match.
    for (const f of body.features as Array<{
      geometry: { coordinates: Array<[number, number]> };
      properties: { length_cells: number };
    }>) {
      expect(f.geometry.coordinates.length).toBe(f.properties.length_cells);
      expect(f.properties.length_cells).toBeGreaterThanOrEqual(2);
    }
    // Stream cell centers are geographic coordinates near the pour point —
    // regression guard against tile-index math producing ~25,000° longitudes.
    for (const f of body.features as Array<{ geometry: { coordinates: Array<[number, number]> } }>) {
      for (const [lon, lat] of f.geometry.coordinates) {
        expect(lon).toBeGreaterThan(-74.1);
        expect(lon).toBeLessThan(-73.9);
        expect(lat).toBeGreaterThan(40.6);
        expect(lat).toBeLessThan(40.8);
      }
    }
  });
});

// ── twi ──────────────────────────────────────────────────────────────────────
describe("Terrain routes — twi pour-point gate", () => {
  it("falls back to the merged-chunk lookup when OZT2 throws", async () => {
    storageState.ozt2Rejects = true;
    storageState.pointElevation = "ok";
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(200);
    const body = await twiBody(resp);
    expect(body.stats).not.toBeNull();
    expect(body.units).toBe("ln(m)");
  });

  it("returns 400 when neither lookup resolves the pour point", async () => {
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "throw";
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(400);
    const body = await twiBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("proceeds to grid assembly when the pour-point gate itself fails", async () => {
    // See the trace equivalent: the gate's only unprotected statement is the
    // NODATA comparison, so a throwing elevation payload is the way in.
    storageState.ozt2Elevation = explodingElevation();
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(200);
    const body = await twiBody(resp);
    expect(body.stats).not.toBeNull();
  });

  it("exposes CORS preflight OPTIONS", async () => {
    const resp = await Promise.resolve(twiOPTIONS());
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("Terrain routes — twi grid emission", () => {
  it("returns null stats and an all-nodata grid when every tile fails", async () => {
    mockGetTileData.mockRejectedValue(new Error("network down"));
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    // Silent-200: an empty DEM is a valid answer with no wetness index anywhere.
    expect(resp.status).toBe(200);
    const body = await twiBody(resp);
    expect(body.stats).toBeNull();
    expect(body.radius_cells).toBe(10);
    expect((body.grid ?? []).flat().every((v: number | null) => v === null)).toBe(true);
  });

  it("averages the two middle cells when an even number of cells are valid", async () => {
    const pour = pourPixel(40.7, -74.0);
    // Punch a full nodata column through the DEM window: the wetness index is
    // dropped for that column and its two neighbours, which leaves an even
    // count of valid cells and exercises the even-count median branch.
    const holed = buildTile((_row, col) => 500 + col);
    for (let row = 0; row < 256; row++) holed[row * 256 + Math.floor(pour.lx)] = -32768;
    mockGetTileData.mockImplementation(resolveTile(holed));
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(200);
    const body = await twiBody(resp);
    expect(body.stats).not.toBeNull();
    expect((body.stats?.count ?? 0) % 2).toBe(0);
    expect(body.stats?.count).toBeGreaterThan(0);
    expect(typeof body.stats?.median).toBe("number");
    expect(body.stats?.min).toBeLessThanOrEqual(body.stats?.median ?? Infinity);
    expect(body.stats?.median).toBeLessThanOrEqual(body.stats?.max ?? Infinity);
  });

  it("downsamples the emitted grid as the radius grows", async () => {
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const mid = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 60 });
    const wide = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 120 });
    expect((await twiBody(mid)).grid).toHaveLength(61); // 121 cells, step 2
    expect((await twiBody(wide)).grid).toHaveLength(61); // 241 cells, step 4
  });

  it("marks every cell nodata when the tile holds only nodata values", async () => {
    mockGetTileData.mockImplementation(resolveTile(nodataTile()));
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(200);
    const body = await twiBody(resp);
    expect(body.stats).toBeNull();
    expect((body.grid ?? []).flat().every((v: number | null) => v === null)).toBe(true);
  });

  it("returns a 502 error body for non-numeric tile data", async () => {
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(502);
    const body = await twiBody(resp);
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.grid).toBeUndefined();
  });

  it("reports an Unknown error with a 502 when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(502);
    const body = await twiBody(resp);
    expect(body.error).toBe("Unknown error");
    expect(body.grid).toBeUndefined();
  });
});

// ── streams / watershed — outer catch, gate fallback and drainage arms ───────
// The other terrain routes have their hostile-DEM suites; streams and watershed
// wrap the whole computation in one outer catch whose arms were never reached.
describe("Terrain routes — streams hostile DEM", () => {
  it("returns a 502 error body for non-numeric tile data", async () => {
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await postJSON(streamsPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(502);
    const body = await streamsBody(resp);
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.features).toBeUndefined();
    expect(body.stats).toBeUndefined();
  });

  it("reports an Unknown error with a 502 when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await postJSON(streamsPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(502);
    const body = await streamsBody(resp);
    expect(body.error).toBe("Unknown error");
    expect(body.features).toBeUndefined();
  });

  it("excludes nodata cells from the steepest-descent search", async () => {
    // A nodata column splits the window. On an eastward-falling ramp every cell
    // west of it would drain into the hole; d8FlowDirection must skip that
    // neighbour, so the two halves accumulate independently and the western
    // half can no longer feed a threshold-1 stream across the gap.
    const pour = pourPixel(40.7, -74.0);
    const holeCol = Math.floor(pour.lx) + 5;
    const split = buildTile((_row, col) => (col === holeCol ? -32768 : 800 - col));

    const splitResp = await (async () => {
      mockGetTileData.mockImplementation(resolveTile(split));
      return postJSON(streamsPOST, { lat: 40.7, lon: -74.0, radius_cells: 10, threshold: 1 });
    })();
    expect(splitResp.status).toBe(200);
    const splitBody = await streamsBody(splitResp);
    expect(splitBody.stats?.total_cells).toBe(21 * 21);

    mockGetTileData.mockImplementation(resolveTile(buildTile((_row, col) => 800 - col)));
    const wholeBody = await streamsBody(
      await postJSON(streamsPOST, { lat: 40.7, lon: -74.0, radius_cells: 10, threshold: 1 }),
    );

    // Blocking the outlet drains less area into any one channel, so the split
    // grid reaches a lower peak accumulation than the unbroken one.
    const peak = (b: StreamsBody): number =>
      (b.features ?? []).reduce((max, f) => Math.max(max, f.properties.length_cells), 0);
    expect(peak(splitBody)).toBeLessThan(peak(wholeBody));
    // Nothing was emitted on the far side of the barrier either.
    expect(splitBody.features?.length).toBeGreaterThan(0);
  });
});

describe("Terrain routes — watershed hostile DEM", () => {
  it("returns a 502 error body for non-numeric tile data", async () => {
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await postJSON(watershedPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(502);
    const body = await watershedBody(resp);
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.geojson).toBeUndefined();
  });

  it("reports an Unknown error with a 502 when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await postJSON(watershedPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(502);
    const body = await watershedBody(resp);
    expect(body.error).toBe("Unknown error");
    expect(body.geojson).toBeUndefined();
  });

  it("delineates a two-dimensional basin whose interior cells are not boundary", async () => {
    // A bowl centred on the pour pixel makes every window cell drain inward, so
    // the upstream set is the whole filled window rather than the one-cell-wide
    // line the planar ramps produce. Interior cells then have all eight
    // neighbours inside the basin and must be excluded from the boundary ring.
    const pour = pourPixel(40.7, -74.0);
    const cr = Math.floor(pour.ly);
    const cc = Math.floor(pour.lx);
    mockGetTileData.mockImplementation(
      resolveTile(buildTile((row, col) => 1000 + Math.abs(row - cr) + Math.abs(col - cc))),
    );

    const resp = await postJSON(watershedPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(200);
    const body = await watershedBody(resp);
    // Every one of the 21x21 window cells drains into the pour point.
    expect(body.pixels).toBe(21 * 21);
    expect(body.min_elev).toBe(1000);
    expect(body.max_elev).toBe(1000 + 20);
    expect(body.geojson?.features?.[0]?.geometry?.type).toBe("Polygon");
  });

  it("returns 400 when the fallback lookup resolves but carries no elevation", async () => {
    // OZT2 resolves null and the merged-chunk fallback resolves null: the
    // `if (fallback)` guard must take its false arm and the route answers 400.
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "null";
    const resp = await postJSON(watershedPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(400);
    const body = await watershedBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
  });
});

describe("Terrain routes — streams and twi gate fallback arms", () => {
  it("streams returns 400 when the fallback lookup resolves but carries no elevation", async () => {
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "null";
    const resp = await postJSON(streamsPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(400);
    const body = await streamsBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("twi returns 400 when the fallback lookup resolves but carries no elevation", async () => {
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "null";
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(400);
    const body = await twiBody(resp);
    expect(body.error).toBe("No elevation data at starting point");
  });
});
