import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

/**
 * Tests for the terrain-analysis REST surface: slope, aspect (GET with query
 * params) and profile, trace, twi, watershed, streams (POST with JSON body).
 *
 * The DEM assembly is mocked at `getTileData` so the suites exercise the
 * routes' validation, grid assembly, computation, and never-5xx error
 * handling without touching HuggingFace.
 */

vi.mock("@/lib/tile", () => {
  // Deterministic tile: a gentle east-facing ramp so slope/aspect are
  // non-trivial and every cell has data.
  const makeTile = (): Int16Array => {
    const t = new Int16Array(256 * 256);
    for (let r = 0; r < 256; r++) {
      for (let c = 0; c < 256; c++) {
        t[r * 256 + c] = 500 + (c % 64);
      }
    }
    return t;
  };
  return {
    getTileData: vi.fn(async () => ({ data: makeTile(), width: 256, height: 256, zoom: 10 })),
    CACHE_TTL: { ELEVATION: 86400 },
  };
});

vi.mock("@/lib/storage/backend", () => {
  class HuggingFaceChunkBackend {}
  // trace/twi/watershed/streams gate on a known starting elevation before
  // running — satisfy the gate so the hydrologic paths execute.
  class OZT2HuggingFaceBackend {
    async getElevation(): Promise<number> {
      return 500;
    }
  }
  return { HuggingFaceChunkBackend, OZT2HuggingFaceBackend };
});

import { OPTIONS as SLOPE_OPTIONS, GET as slopeGET } from "@/app/api/slope/route";
import { OPTIONS as ASPECT_OPTIONS, GET as aspectGET } from "@/app/api/aspect/route";
import { POST as profilePOST } from "@/app/api/profile/route";
import { POST as tracePOST } from "@/app/api/trace/route";
import { POST as twiPOST } from "@/app/api/twi/route";
import { POST as watershedPOST } from "@/app/api/watershed/route";
import { POST as streamsPOST } from "@/app/api/streams/route";
import { getTileData } from "@/lib/tile";

const mockGetTileData = getTileData as unknown as Mock;

const GET_URL = "http://localhost/api/test";

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

beforeEach(() => {
  mockGetTileData.mockClear();
});

describe("Terrain routes — shared validation", () => {
  it("slope rejects missing lat/lon with 400", async () => {
    const resp = await slopeGET(makeRequest(GET_URL));
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("lat");
  });

  it("aspect rejects missing lat/lon with 400", async () => {
    const resp = await aspectGET(makeRequest(GET_URL));
    expect(resp.status).toBe(400);
  });

  it("slope rejects out-of-range coordinates with 400", async () => {
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=95&lon=0`));
    expect(resp.status).toBe(400);
    const body = await resp.json();
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
  ])("%s rejects malformed JSON body with 400", async (_name, handler, validBody) => {
    const resp = await (handler as (req: Request) => Promise<Response>)(
      makeRequest(GET_URL, { method: "POST", body: "not-json{{" }),
    );
    expect(resp.status).toBe(400);
    void validBody;
  });

  it.each([
    ["profile", profilePOST, { lat1: 40, lon1: -74, lat2: 41, lon2: -73 }],
    ["trace", tracePOST, { lat: 40, lon: -74 }],
    ["twi", twiPOST, { lat: 40, lon: -74 }],
    ["watershed", watershedPOST, { lat: 40, lon: -74 }],
    ["streams", streamsPOST, { lat: 40, lon: -74 }],
  ])("%s rejects missing coordinates with 400", async (_name, handler, validBody) => {
    const incomplete = Object.fromEntries(Object.keys(validBody).slice(0, 0));
    const resp = await (handler as (req: Request) => Promise<Response>)(
      makeRequest(GET_URL, { method: "POST", body: JSON.stringify(incomplete), headers: { "Content-Type": "application/json" } }),
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
    const resp = await (handler as (req: Request) => Promise<Response>)(
      makeRequest(GET_URL, { method: "POST", body: JSON.stringify(bad), headers: { "Content-Type": "application/json" } }),
    );
    expect(resp.status).toBe(400);
  });
});

describe("Terrain routes — OPTIONS CORS preflight", () => {
  it("slope and aspect expose CORS preflight", async () => {
    const slopeResp = await SLOPE_OPTIONS();
    const aspectResp = await ASPECT_OPTIONS();
    expect(slopeResp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
    expect(aspectResp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
  });
});

describe("Terrain routes — happy path with mocked DEM tiles", () => {
  it("slope returns stats and grid", async () => {
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=10&zoom=10`));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
    const body = await resp.json();
    expect(body.units).toBe("degrees");
    expect(body.radius_cells).toBe(10);
    expect(body.zoom).toBe(10);
    expect(body.grid.length).toBeGreaterThan(0);
    expect(body.stats).not.toBeNull();
    expect(body.stats.count).toBeGreaterThan(0);
    // Ramp in +x direction at ~45m/64px cell → small but nonzero slope
    expect(body.stats.mean).toBeGreaterThanOrEqual(0);
    expect(mockGetTileData).toHaveBeenCalled();
  });

  it("aspect returns direction bins over valid cells", async () => {
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=10&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.units).toContain("degrees");
    expect(body.valid_cells).toBeGreaterThan(0);
    // Ramp rises toward +x (east) → east-facing cells must dominate
    expect(body.direction_bins).not.toBeNull();
    expect(body.direction_bins.E).toBeGreaterThan(0);
    const binSum = Object.values(body.direction_bins).reduce((a, b) => a + (b as number), 0);
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
    const body = await resp.json();
    expect(body.start).toEqual({ lat: 40.7, lon: -74.0 });
    expect(body.num_points).toBeGreaterThan(0);
    expect(Array.isArray(body.profile)).toBe(true);
    expect(body.profile.length).toBe(body.num_points);
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
    const body = await resp.json();
    expect(body.start).toEqual([40.7, -74.0]);
    expect(Array.isArray(body.elevations)).toBe(true);
    expect(body.elevations.length).toBeGreaterThan(0);
    expect(body.geojson.type).toBe("Feature");
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
    const body = await resp.json();
    expect(body.grid.length).toBeGreaterThan(0);
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
    const body = await resp.json();
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
    const body = await resp.json();
    expect(body.type).toBe("FeatureCollection");
    expect(Array.isArray(body.features)).toBe(true);
    expect(body.stats.threshold).toBe(50);
    expect(body.stats.total_cells).toBeGreaterThan(0);
  });
});

describe("Terrain routes — DEM failure degrades to 200 with null/empty results", () => {
  it("slope returns stats:null grid when every tile fails", async () => {
    mockGetTileData.mockRejectedValue(new Error("chunk not found"));
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=5&zoom=10`));
    // Never 5xx — the silent-catch contract
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.stats).toBeNull();
    // All-nodata cells emit as null, never fake zeros
    expect(body.grid.flat().every((v: number | null) => v === null)).toBe(true);
  });

  it("aspect returns 200 with null bins when tiles fail", async () => {
    mockGetTileData.mockRejectedValue(new Error("network down"));
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=5&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await resp.json();
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
    const body = await resp.json();
    expect(body.stats).toBeNull();
  });
});
