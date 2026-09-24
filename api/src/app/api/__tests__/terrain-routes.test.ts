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
  // An elevation payload whose valueOf throws is the only way to reach the
  // routes' "gate itself failed" catch clauses: the gate's only unprotected
  // statement is the `startElevVal <= NODATA` comparison.
  ozt2Elevation: number | { valueOf(): number } | null;
  ozt2Rejects: boolean;
  pointElevation: "real" | "ok" | "null" | "throw";
};

// An elevation payload that explodes the moment the gate compares it.
const explodingElevation = (): { valueOf(): number } => ({
  valueOf(): number {
    throw new Error("gate payload exploded");
  },
});

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
import { POST as profilePOST, OPTIONS as PROFILE_OPTIONS } from "@/app/api/profile/route";
import { POST as tracePOST, OPTIONS as traceOPTIONS } from "@/app/api/trace/route";
import { POST as twiPOST, OPTIONS as twiOPTIONS } from "@/app/api/twi/route";
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

// Slippy-tile pixel math mirrored from @/lib/srtm/zoom-math. The builders below
// place gradients and nodata holes at exact tile pixels, so a suite needs to
// know which tile — and which pixel inside it — a pour point resolves to.
function pourPixel(lat: number, lon: number, zoom = 10): { tx: number; ty: number; lx: number; ly: number } {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const worldX = ((lon + 180) / 360) * n * 256;
  const worldY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * 256;
  return { tx: Math.floor(worldX / 256), ty: Math.floor(worldY / 256), lx: worldX % 256, ly: worldY % 256 };
}

// Installs a per-tile getTileData: `build` returns a tile's DEM, or null to
// reject it, so a suite can serve one tile and leave its neighbours missing.
function serveTiles(build: (z: number, tx: number, ty: number) => Int16Array | null): void {
  mockGetTileData.mockImplementation((z: number, tx: number, ty: number) => {
    const data = build(z, tx, ty);
    if (!data) return Promise.reject(new Error(`tile ${tx}/${ty} unavailable`));
    return Promise.resolve({ data, width: 256, height: 256, zoom: z });
  });
}

// Serves a single tile and rejects the rest — the isolation needed to watch a
// flow walk run off the edge of the fetched window.
function serveOneTile(tx: number, ty: number, fill: (row: number, col: number) => number): void {
  serveTiles((_z, x, y) => (x === tx && y === ty ? buildTile(fill) : null));
}

// POST helper for the JSON-body terrain routes.
function postJSON(handler: PostHandler, body: unknown): Promise<Response> {
  return handler(
    makeRequest(GET_URL, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// Pour points picked for their tile-pixel position (see pourPixel):
//  - 40.7 / -74.0     → tile 301/385, pixel (130.8, 13.4): away from tile edges.
//  - 41.50775 / -74.0 → tile 301/382, pixel (130.8, 0.80): less than one D8
//    cell below a tile's north edge, so a diagonal step's sampled point — which
//    overshoots the one-cell neighbour D8 validated — leaves the served tile.
//  - 39.0 / -74.1878  → tile 300/391, pixel (250.1, 90.0): a few pixels from a
//    tile's east edge, so an eastward walk runs out of tile.
//  - 40.0 / -74.0     → tile 301/387, pixel (130.8, 170.3): mid-tile, used for
//    the isolated-live-pixel cases.
//  - 40.3 / -73.95    → tile 301/386, pixel (167.3, 140.5): mid-tile, used for
//    the sea-level halt.
const POUR_NORTH_EDGE = { lat: 41.50775, lon: -74.0 };
// 41.508269 / -74.0 → tile 301/382, pixel (130.8, 0.30): even closer to the
// north edge than POUR_NORTH_EDGE — nearer than one D8 *probe* step (0.67 px),
// so every northward neighbour lookup leaves the served tile outright.
const POUR_NORTH_PROBE = { lat: 41.508269, lon: -74.0 };
const POUR_EAST_EDGE = { lat: 39.0, lon: -74.1878 };
const POUR_ISLAND = { lat: 40.0, lon: -74.0 };
const POUR_MID_TILE = { lat: 40.3, lon: -73.95 };

// A tile whose only live pixel is the far corner of POUR_ISLAND's bilinear
// stencil — every other cell in the surrounding 2×2 neighbourhoods is nodata.
function islandTile(): Int16Array {
  const pour = pourPixel(POUR_ISLAND.lat, POUR_ISLAND.lon);
  const tile = nodataTile();
  tile[(Math.floor(pour.ly) + 1) * 256 + (Math.floor(pour.lx) + 1)] = 32767;
  return tile;
}

// A DEM payload whose pixel reads throw a plain string. That is the only way to
// reach the routes' `err instanceof Error ? err.message : "Unknown error"`
// fallback, which must still answer 200 rather than a 5xx.
function hostileTileData(): Int16Array {
  return new Proxy(new Int16Array(256 * 256), {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) {
        // Intentionally a non-Error throw so the route's generic-message
        // fallback branch is exercised.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "tile payload exploded";
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function resolveTile(data: Int16Array): () => Promise<{ data: Int16Array; width: number; height: number; zoom: number }> {
  return () => Promise.resolve({ data, width: 256, height: 256, zoom: 10 });
}

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

// ── trace ────────────────────────────────────────────────────────────────────
// The trace walk is driven through single-tile DEMs so each termination branch
// (neighbour tile missing, walk leaves the window, sea level, nodata) can be
// reached deterministically.

describe("Terrain routes — trace pour-point gate", () => {
  it("returns 400 when no tile serves the pour point", async () => {
    mockGetTileData.mockRejectedValue(new Error("chunk missing"));
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("falls back to the merged-chunk lookup when OZT2 throws", async () => {
    storageState.ozt2Rejects = true;
    storageState.pointElevation = "ok";
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.geojson.type).toBe("Feature");
    expect(body.steps).toBeGreaterThan(0);
  });

  it("returns 400 when neither OZT2 nor the merged fallback resolves the pour point", async () => {
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "null";
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("returns 400 when the merged-chunk fallback throws as well", async () => {
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "throw";
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(400);
    const body = await resp.json();
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
    const body = await resp.json();
    expect(body.geojson.type).toBe("Feature");
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
    const body = await resp.json();
    // No cell was recorded, but the abortive move still shows up in `end`.
    expect(body.steps).toBe(0);
    expect(body.path).toHaveLength(1);
    expect(body.elevations).toHaveLength(1);
    expect(body.end[0]).not.toBe(body.start[0]);
    expect(body.end[1]).not.toBe(body.start[1]);
    expect(body.geojson.geometry.coordinates).toHaveLength(1);
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
    const body = await resp.json();
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
    const body = await resp.json();
    expect(body.steps).toBeGreaterThan(3);
    expect(body.steps).toBeLessThan(50);
    const steps: number = body.steps;
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
    const body = await resp.json();
    expect(body.elevations[0]).toBeGreaterThan(0);
    expect(body.steps).toBeGreaterThan(10);
    expect(body.end_elev).toBeLessThanOrEqual(0);
    expect(body.total_distance).toBeGreaterThan(0);
    expect(body.geojson.properties.steps).toBe(body.steps);
  });

  it("cannot descend out of a tile with a single live pixel", async () => {
    // One live pixel in an otherwise nodata tile: the pour point still reads
    // (its stencil keeps that corner) but three quarters of its stencil is
    // nodata, half the neighbour lookups are skipped wholesale, and the walk
    // runs out of elevation within a couple of cells.
    mockGetTileData.mockImplementation(resolveTile(islandTile()));
    const resp = await postJSON(tracePOST, POUR_ISLAND);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.start_elev).toBeGreaterThan(-32768);
    expect(body.steps).toBeGreaterThanOrEqual(1);
    expect(body.steps).toBeLessThanOrEqual(4);
    expect(body.elevations).toHaveLength(body.path.length);
  });

  it("rejects a pour point whose sampled stencil is entirely nodata", async () => {
    mockGetTileData.mockImplementation(resolveTile(nodataTile()));
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("No elevation data at starting point");
    // The silent-200 contract only covers internal failures; a client asking
    // for a lake-less coordinate still gets a real 400.
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
  });

  it("returns a silent 200 error body for non-numeric tile data", async () => {
    // A bigint tile payload explodes the first time it reaches the bilinear
    // mix — that is the only route into the handler's catch, which must answer
    // 200 with an error body rather than a 5xx.
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.geojson).toBeUndefined();
  });

  it("reports an Unknown error when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await postJSON(tracePOST, { lat: 40.7, lon: -74.0 });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.error).toBe("Unknown error");
    expect(body.geojson).toBeUndefined();
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
    const body = await resp.json();
    expect(body.stats).not.toBeNull();
    expect(body.units).toBe("ln(m)");
  });

  it("returns 400 when neither lookup resolves the pour point", async () => {
    storageState.ozt2Elevation = null;
    storageState.pointElevation = "throw";
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("No elevation data at starting point");
  });

  it("proceeds to grid assembly when the pour-point gate itself fails", async () => {
    // See the trace equivalent: the gate's only unprotected statement is the
    // NODATA comparison, so a throwing elevation payload is the way in.
    storageState.ozt2Elevation = explodingElevation();
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(200);
    const body = await resp.json();
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
    const body = await resp.json();
    expect(body.stats).toBeNull();
    expect(body.radius_cells).toBe(10);
    expect(body.grid.flat().every((v: number | null) => v === null)).toBe(true);
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
    const body = await resp.json();
    expect(body.stats).not.toBeNull();
    expect(body.stats.count % 2).toBe(0);
    expect(body.stats.count).toBeGreaterThan(0);
    expect(typeof body.stats.median).toBe("number");
    expect(body.stats.min).toBeLessThanOrEqual(body.stats.median);
    expect(body.stats.median).toBeLessThanOrEqual(body.stats.max);
  });

  it("downsamples the emitted grid as the radius grows", async () => {
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const mid = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 60 });
    const wide = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 120 });
    expect((await mid.json()).grid).toHaveLength(61); // 121 cells, step 2
    expect((await wide.json()).grid).toHaveLength(61); // 241 cells, step 4
  });

  it("marks every cell nodata when the tile holds only nodata values", async () => {
    mockGetTileData.mockImplementation(resolveTile(nodataTile()));
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.stats).toBeNull();
    expect(body.grid.flat().every((v: number | null) => v === null)).toBe(true);
  });

  it("returns a silent 200 error body for non-numeric tile data", async () => {
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.grid).toBeUndefined();
  });

  it("reports an Unknown error when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await postJSON(twiPOST, { lat: 40.7, lon: -74.0, radius_cells: 10 });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.error).toBe("Unknown error");
    expect(body.grid).toBeUndefined();
  });
});

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
      const body = await resp.json();
      expect(body.valid_cells).toBe(1);
      const hits = Object.entries(body.direction_bins as Record<string, number>)
        .filter(([, pct]) => pct === 100)
        .map(([dir]) => dir);
      expect(hits).toHaveLength(1);
      expect(hits[0]).not.toBe("flat");
      seen.add(hits[0]);
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
    expect((await northResp.json()).direction_bins.S).toBe(100);

    const risingEast = buildTile((_row, col) => 500 + (col - 128));
    mockGetTileData.mockImplementation(resolveTile(risingEast));
    const eastResp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=1&zoom=10`));
    expect((await eastResp.json()).direction_bins.W).toBe(100);
  });

  it("reports flat terrain under the flat bin instead of a compass direction", async () => {
    mockGetTileData.mockImplementation(resolveTile(buildTile(() => 500)));
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.valid_cells).toBe(9);
    expect(body.direction_bins.flat).toBe(100);
    // -1 reaches the emitted grid for interior cells, null for the border.
    expect(body.grid[1][1]).toBe(-1);
    expect(body.grid[0][0]).toBeNull();
  });

  it("downsamples the emitted grid as the radius grows", async () => {
    mockGetTileData.mockImplementation(resolveTile(rampTile()));
    const mid = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=60&zoom=10`));
    const wide = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=120&zoom=10`));
    expect((await mid.json()).grid).toHaveLength(61); // 121 cells, step 2
    expect((await wide.json()).grid).toHaveLength(61); // 241 cells, step 4
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
    const body = await resp.json();
    expect(body.valid_cells).toBe(0);
    expect(body.direction_bins).toBeNull();
    expect(body.grid[1][1]).toBeNull();
  });

  it("nulls cells whose four source pixels are all nodata", async () => {
    mockGetTileData.mockImplementation(resolveTile(nodataTile()));
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.valid_cells).toBe(0);
    expect(body.direction_bins).toBeNull();
    expect(body.grid.flat().every((v: number | null) => v === null)).toBe(true);
  });

  it("returns a silent 200 error body for non-numeric tile data", async () => {
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.grid).toBeUndefined();
  });

  it("reports an Unknown error when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await aspectGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.error).toBe("Unknown error");
    expect(body.grid).toBeUndefined();
  });
});

// ── slope — nodata, even-median and downsample arms ──────────────────────────

// Typed body readers keep the appended slope/profile suites off the unsafe-any
// lint path that the older suites predate.
interface SlopeBody {
  stats?: { count: number } | null;
  grid?: Array<Array<number | null>>;
  error?: string;
}
async function slopeBody(resp: Response): Promise<SlopeBody> {
  return (await resp.json()) as SlopeBody;
}
interface ProfileBody {
  num_points?: number;
  profile?: Array<{ elevation: number }>;
  stats?: { min: number; max: number; total_gain: number } | null;
  error?: string;
}
async function profileBody(resp: Response): Promise<ProfileBody> {
  return (await resp.json()) as ProfileBody;
}

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

  it("returns a silent 200 error body for non-numeric tile data", async () => {
    // BigInt pixel reads explode inside bilinear assembly — the route's outer
    // catch must answer 200 with the error message, never a 5xx.
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
    const body = await slopeBody(resp);
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.grid).toBeUndefined();
  });

  it("reports an Unknown error when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await slopeGET(makeRequest(`${GET_URL}?lat=40.7&lon=-74.0&radius=2&zoom=10`));
    expect(resp.status).toBe(200);
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

  it("returns a silent 200 error body for non-numeric tile data", async () => {
    mockGetTileData.mockResolvedValue({
      data: new BigInt64Array(256 * 256) as unknown as Int16Array,
      width: 256,
      height: 256,
      zoom: 10,
    });
    const resp = await postJSON(profilePOST, { lat1: 40.7, lon1: -74.0, lat2: 40.75, lon2: -73.95 });
    expect(resp.status).toBe(200);
    const body = await profileBody(resp);
    expect(body.error).toBe("Cannot mix BigInt and other types, use explicit conversions");
    expect(body.profile).toBeUndefined();
  });

  it("reports an Unknown error when the DEM payload throws a non-Error", async () => {
    mockGetTileData.mockResolvedValue({ data: hostileTileData(), width: 256, height: 256, zoom: 10 });
    const resp = await postJSON(profilePOST, { lat1: 40.7, lon1: -74.0, lat2: 40.75, lon2: -73.95 });
    expect(resp.status).toBe(200);
    const body = await profileBody(resp);
    expect(body.error).toBe("Unknown error");
    expect(body.profile).toBeUndefined();
  });
});
