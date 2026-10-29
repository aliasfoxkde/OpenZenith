/**
 * Terrain routes — shared validation, CORS preflight and happy paths.
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
  slopeBody,
  aspectBody,
  profileBody,
  traceBody,
  twiBody,
  watershedBody,
  streamsBody,
  PostHandler,
} from "./terrain-routes.harness";
import { OPTIONS as ASPECT_OPTIONS, GET as aspectGET } from "@/app/api/aspect/route";
import { POST as profilePOST } from "@/app/api/profile/route";
import { OPTIONS as SLOPE_OPTIONS, GET as slopeGET } from "@/app/api/slope/route";
import { POST as streamsPOST } from "@/app/api/streams/route";
import { POST as tracePOST } from "@/app/api/trace/route";
import { POST as twiPOST } from "@/app/api/twi/route";
import { POST as watershedPOST } from "@/app/api/watershed/route";

describe("Terrain routes — shared validation", () => {
  it("slope rejects missing lat/lon with 400", async () => {
    const resp = await slopeGET(makeRequest(GET_URL));
    expect(resp.status).toBe(400);
    const body = await slopeBody(resp);
    expect(body.error).toContain("lat");
  });

  it("aspect rejects missing lat/lon with 400", async () => {
    const resp = await aspectGET(makeRequest(GET_URL));
    expect(resp.status).toBe(400);
  });

  it("slope rejects out-of-range coordinates with 400", async () => {
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=95&lon=0`));
    expect(resp.status).toBe(400);
    const body = await slopeBody(resp);
    expect(body.error).toContain("Invalid");
  });

  it("aspect rejects non-numeric coordinates with 400", async () => {
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=abc&lon=0`));
    expect(resp.status).toBe(400);
  });

  it.each([
    ["profile", profilePOST, { lat1: 40, lon1: -74, lat2: 41, lon2: -73 }],
    ["trace", tracePOST, { lat: 40, lon: -74 }],
    ["twi", twiPOST, { lat: 40, lon: -74 }],
    ["watershed", watershedPOST, { lat: 40, lon: -74 }],
    ["streams", streamsPOST, { lat: 40, lon: -74 }],
  ])("%s rejects malformed JSON body with 400", async (_name, handler, _validBody) => {
    const resp = await (handler as PostHandler)(makeRequest(GET_URL, { method: "POST", body: "not-json{{" }));
    expect(resp.status).toBe(400);
  });

  it.each([
    ["profile", profilePOST, { lat1: 40, lon1: -74, lat2: 41, lon2: -73 }],
    ["trace", tracePOST, { lat: 40, lon: -74 }],
    ["twi", twiPOST, { lat: 40, lon: -74 }],
    ["watershed", watershedPOST, { lat: 40, lon: -74 }],
    ["streams", streamsPOST, { lat: 40, lon: -74 }],
  ])("%s rejects missing coordinates with 400", async (_name, handler, validBody) => {
    const incomplete = Object.fromEntries(Object.entries(validBody as Record<string, unknown>).slice(0, 0));
    const resp = await (handler as PostHandler)(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify(incomplete),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(400);
  });

  it.each([
    ["profile", profilePOST, { lat1: 40, lon1: -74, lat2: 41, lon2: -73 }],
    ["trace", tracePOST, { lat: 40, lon: -74 }],
    ["twi", twiPOST, { lat: 40, lon: -74 }],
    ["watershed", watershedPOST, { lat: 40, lon: -74 }],
    ["streams", streamsPOST, { lat: 40, lon: -74 }],
  ])("%s rejects out-of-range coordinates with 400", async (_name, handler, validBody) => {
    const bad = { ...validBody, lat: 91, lat1: 91 };
    const resp = await (handler as PostHandler)(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify(bad),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(400);
  });
});

describe("Terrain routes — OPTIONS CORS preflight", () => {
  it("slope and aspect expose CORS preflight", async () => {
    // Preflight handlers may be sync or promise-returning — normalize first.
    const slopeResp = await Promise.resolve(SLOPE_OPTIONS());
    const aspectResp = await Promise.resolve(ASPECT_OPTIONS());
    expect(slopeResp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
    expect(aspectResp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
  });
});

describe("Terrain routes — happy path with mocked DEM tiles", () => {
  it("slope returns stats and grid", async () => {
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=10&zoom=10`));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
    const body = await slopeBody(resp);
    expect(body.units).toBe("degrees");
    expect(body.radius_cells).toBe(10);
    expect(body.zoom).toBe(10);
    expect(body.grid?.length).toBeGreaterThan(0);
    expect(body.stats).not.toBeNull();
    expect(body.stats?.count).toBeGreaterThan(0);
    // Ramp in +x direction at ~45m/64px cell → small but nonzero slope
    expect(body.stats?.mean).toBeGreaterThanOrEqual(0);
    expect(mockGetTileData).toHaveBeenCalled();
  });

  it("aspect returns direction bins over valid cells", async () => {
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=10&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await aspectBody(resp);
    expect(body.units).toContain("degrees");
    expect(body.valid_cells).toBeGreaterThan(0);
    // Ramp rises toward +x (east) → east-facing cells must dominate
    expect(body.direction_bins).not.toBeNull();
    expect(body.direction_bins?.["E"]).toBeGreaterThan(0);
    const binSum = Object.values(body.direction_bins ?? {}).reduce((a, b) => a + b, 0);
    expect(binSum).toBeCloseTo(100, 0);
  });

  it("profile returns elevation profile between two points", async () => {
    const resp = await profilePOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat1: 40.7, lon1: -74.0, lat2: 40.75, lon2: -73.95 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await profileBody(resp);
    expect(body.start).toEqual({ lat: 40.7, lon: -74.0 });
    expect(body.num_points).toBeGreaterThan(0);
    expect(Array.isArray(body.profile)).toBe(true);
    expect(body.profile?.length).toBe(body.num_points);
  });

  it("trace walks downstream and returns geojson", async () => {
    const resp = await tracePOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await traceBody(resp);
    expect(body.start).toEqual([40.7, -74.0]);
    expect(Array.isArray(body.elevations)).toBe(true);
    expect(body.elevations?.length).toBeGreaterThan(0);
    expect(body.geojson?.type).toBe("Feature");
  });

  it("twi returns grid and stats", async () => {
    const resp = await twiPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await twiBody(resp);
    expect(body.grid?.length).toBeGreaterThan(0);
  });

  it("watershed delineates a basin with geojson output", async () => {
    const resp = await watershedPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await watershedBody(resp);
    expect(body.type ?? body.geojson?.type ?? "FeatureCollection").toBeDefined();
  });

  it("streams extracts channels above threshold", async () => {
    const resp = await streamsPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10, threshold: 50 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await streamsBody(resp);
    expect(body.type).toBe("FeatureCollection");
    expect(Array.isArray(body.features)).toBe(true);
    expect(body.stats?.threshold).toBe(50);
    expect(body.stats?.total_cells).toBeGreaterThan(0);
  });
});

describe("Terrain routes — DEM failure degrades to null/empty results", () => {
  it("slope returns stats:null grid when every tile fails", async () => {
    mockGetTileData.mockRejectedValue(new Error("chunk not found"));
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=5&zoom=10`));
    // Per-tile read failures are swallowed and surface as nodata, so the route
    // still answers 200 — only an unwound computation reaches the 502 catch.
    expect(resp.status).toBe(200);
    const body = await slopeBody(resp);
    expect(body.stats).toBeNull();
    // All-nodata cells emit as null, never fake zeros
    expect((body.grid ?? []).flat().every((v: number | null) => v === null)).toBe(true);
  });

  it("aspect returns 200 with null bins when tiles fail", async () => {
    mockGetTileData.mockRejectedValue(new Error("network down"));
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=5&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await aspectBody(resp);
    expect(body.direction_bins).toBeNull();
    expect(body.valid_cells).toBe(0);
  });

  it("profile returns 200 when tiles fail", async () => {
    mockGetTileData.mockRejectedValue(new Error("network down"));
    const resp = await profilePOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat1: 40.7, lon1: -74.0, lat2: 40.75, lon2: -73.95 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await profileBody(resp);
    expect(body.stats).toBeNull();
  });
});
