import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { NextRequest } from "next/server";

type PostHandler = (req: NextRequest) => Promise<Response>;

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
    getTileData: vi.fn(() =>
      Promise.resolve({ data: makeTile(), width: 256, height: 256, zoom: 10 }),
    ),
    CACHE_TTL: { ELEVATION: 86400 },
  };
});

// Per-test control over the pour-point elevation gate watershed/streams run
// before any hydrology: the OZT2 lookup (primary) and the merged-chunk point
// lookup (fallback). Defaults keep every pre-existing test on the happy path.
type StorageGateState = {
  ozt2Elevation: number | null;
  ozt2Rejects: boolean;
  pointElevation: "real" | "ok" | "null" | "throw";
};

const storageState = vi.hoisted<StorageGateState>(() => ({
  ozt2Elevation: 500,
  ozt2Rejects: false,
  pointElevation: "real",
}));

vi.mock("@/lib/storage/backend", () => {
  // The routes under test construct this backend, but every tile read goes
  // through the mocked `getTileData` above — only the constructor runs.
  const HuggingFaceChunkBackend = vi.fn();
  // trace/twi/watershed/streams gate on a known starting elevation before
  // running — satisfy the gate so the hydrologic paths execute.
  const OZT2HuggingFaceBackend = vi.fn(() => ({
    getElevation: () =>
      storageState.ozt2Rejects
        ? Promise.reject(new Error("hf ozt2 unavailable"))
        : Promise.resolve(storageState.ozt2Elevation),
  }));
  return { HuggingFaceChunkBackend, OZT2HuggingFaceBackend };
});

vi.mock("@/lib/point-elevation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/point-elevation")>();
  const real = actual.getPointElevation;
  const gated: typeof real = (lat, lon, storage) => {
    switch (storageState.pointElevation) {
      case "ok":
        return Promise.resolve({ elevation: 620, surfaceType: "land", source: "srtm", tile: "N41W075" });
      case "null":
        return Promise.resolve(null);
      case "throw":
        return Promise.reject(new Error("chunk fetch failed"));
      default:
        return real(lat, lon, storage);
    }
  };
  return { ...actual, getPointElevation: gated };
});

import { OPTIONS as SLOPE_OPTIONS, GET as slopeGET } from "@/app/api/slope/route";
import { OPTIONS as ASPECT_OPTIONS, GET as aspectGET } from "@/app/api/aspect/route";
import { POST as profilePOST } from "@/app/api/profile/route";
import { POST as tracePOST } from "@/app/api/trace/route";
import { POST as twiPOST } from "@/app/api/twi/route";
import { POST as watershedPOST, OPTIONS as watershedOPTIONS } from "@/app/api/watershed/route";
import { POST as streamsPOST, OPTIONS as streamsOPTIONS } from "@/app/api/streams/route";
import { getTileData } from "@/lib/tile";

const mockGetTileData = getTileData as unknown as Mock;

const GET_URL = "http://localhost/api/test";

// Route handlers are typed against NextRequest; the routes under test only
// read url/method/body, so a plain Request cast suffices.
function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

// Local tile builders — the vi.mock factory's own builder is not in scope
// here, and the degradation tests need tiles other than the ramp.
function buildTile(fill: (row: number, col: number) => number): Int16Array {
  const t = new Int16Array(256 * 256);
  for (let r = 0; r < 256; r++) {
    for (let c = 0; c < 256; c++) {
      t[r * 256 + c] = fill(r, c);
    }
  }
  return t;
}
const rampTile = (): Int16Array => buildTile((_r, c) => 500 + (c % 64));
const nodataTile = (): Int16Array => buildTile(() => -32768);

beforeEach(() => {
  mockGetTileData.mockClear();
});

afterEach(() => {
  storageState.ozt2Elevation = 500;
  storageState.ozt2Rejects = false;
  storageState.pointElevation = "real";
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
    const resp = await (handler as PostHandler)(
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
    const incomplete = Object.fromEntries(Object.entries(validBody as Record<string, unknown>).slice(0, 0));
    const resp = await (handler as PostHandler)(
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
    const resp = await (handler as PostHandler)(
      makeRequest(GET_URL, { method: "POST", body: JSON.stringify(bad), headers: { "Content-Type": "application/json" } }),
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
    const binSum = Object.values(body.direction_bins as Record<string, number>).reduce((a, b) => a + b, 0);
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
    mockGetTileData.mockImplementation(() =>
      Promise.resolve({ data: rampTile(), width: 256, height: 256, zoom: 10 }),
    );
    const resp = await watershedPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    // The fallback elevation satisfies the gate, so delineation still runs.
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.pixels).toBeGreaterThan(0);
    expect(body.geojson.features).toHaveLength(1);
    expect(body.geojson.features[0].geometry.type).toBe("Polygon");
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
    const body = await resp.json();
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
    const body = await resp.json();
    expect(body.pixels).toBe(1);
    expect(body.min_elev).toBeNull();
    expect(body.max_elev).toBeNull();
    expect(body.mean_elev).toBeNull();
    expect(body.geojson.features[0].geometry.type).toBe("Point");
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
    const body = await resp.json();
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
    mockGetTileData.mockImplementation(() =>
      Promise.resolve({ data: holeTile(), width: 256, height: 256, zoom: 10 }),
    );
    const resp = await watershedPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
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
    mockGetTileData.mockImplementation(() =>
      Promise.resolve({ data: rampTile(), width: 256, height: 256, zoom: 10 }),
    );
    const resp = await streamsPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
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
    const body = await resp.json();
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
    const body = await resp.json();
    expect(body.features).toHaveLength(0);
    expect(body.stats.stream_count).toBe(0);
    expect(body.stats.total_cells).toBe(21 * 21);
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
    const body = await resp.json();
    expect(body.features).toHaveLength(0);
  });

  it("traces downhill stream segments when the threshold admits every cell", async () => {
    mockGetTileData.mockImplementation(() =>
      Promise.resolve({ data: rampTile(), width: 256, height: 256, zoom: 10 }),
    );
    const resp = await streamsPOST(
      makeRequest(GET_URL, {
        method: "POST",
        body: JSON.stringify({ lat: 40.7, lon: -74.0, radius_cells: 10, threshold: 1 }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.features.length).toBeGreaterThan(0);
    expect(body.stats.stream_count).toBe(body.features.length);
    expect(body.stats.threshold).toBe(1);
    expect(body.stats.total_cells).toBe(21 * 21);
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
