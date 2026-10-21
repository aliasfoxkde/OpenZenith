/**
 * Shared harness for the terrain-analysis route suites.
 *
 * The DEM assembly is mocked at `@/lib/tile` and the pour-point elevation
 * gate is mocked at `@/lib/storage/backend` + `@/lib/point-elevation`, so the
 * suites exercise the routes' validation, grid assembly, computation and
 * never-5xx error handling without touching HuggingFace.
 *
 * This module is imported FIRST by every terrain suite: the `vi.mock` calls
 * below are hoisted within this file, so they are registered before the route
 * modules those suites import — the mocks are in place when the routes
 * evaluate. Vitest isolates the module registry per test file, so each suite
 * gets its own harness instance (and its own mock state).
 *
 * The `beforeEach`/`afterEach` hooks here are file-scoped: they reset the
 * mocked DEM and the gate state between the tests of whichever suite imported
 * this module.
 */

import { vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Shape of the POST route handlers under test: they take a `NextRequest` and
 * return a `Response`, with no other surface.
 */
export type PostHandler = (req: NextRequest) => Promise<Response>;

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
    getTileData: vi.fn(() => Promise.resolve({ data: makeTile(), width: 256, height: 256, zoom: 10 })),
    CACHE_TTL: { ELEVATION: 86400 },
  };
});

/**
 * Per-test control over the pour-point elevation gate watershed/streams run
 * before any hydrology: the OZT2 lookup (primary) and the merged-chunk point
 * lookup (fallback). Defaults keep every pre-existing test on the happy path.
 */
export type StorageGateState = {
  // An elevation payload whose valueOf throws is the only way to reach the
  // routes' "gate itself failed" catch clauses: the gate's only unprotected
  // statement is the `startElevVal <= NODATA` comparison.
  ozt2Elevation: number | { valueOf(): number } | null;
  ozt2Rejects: boolean;
  pointElevation: "real" | "ok" | "null" | "throw";
};

/**
 * An elevation payload that explodes the moment the gate compares it.
 */
export const explodingElevation = (): { valueOf(): number } => ({
  valueOf(): number {
    throw new Error("gate payload exploded");
  },
});

// The gate state itself must be hoisted: the mock factories below run before
// this module's body, so they need the object to exist already. Vitest
// forbids EXPORTING a hoisted binding directly ("Cannot export hoisted
// variable"), so the hoisted object stays module-private and the public
// `storageState` handle below proxies it through accessors. The property
// names and types are identical, so suites write `storageState.pointElevation
// = "null"` exactly as they did before the harness was extracted.
const gateState = vi.hoisted<StorageGateState>(() => ({
  ozt2Elevation: 500,
  ozt2Rejects: false,
  pointElevation: "real",
}));

/**
 * Test-visible handle on the mocked pour-point elevation gate state.
 * Writes go straight through to the hoisted object the mocks read.
 */
export const storageState: StorageGateState = {
  get ozt2Elevation() {
    return gateState.ozt2Elevation;
  },
  set ozt2Elevation(value) {
    gateState.ozt2Elevation = value;
  },
  get ozt2Rejects() {
    return gateState.ozt2Rejects;
  },
  set ozt2Rejects(value) {
    gateState.ozt2Rejects = value;
  },
  get pointElevation() {
    return gateState.pointElevation;
  },
  set pointElevation(value) {
    gateState.pointElevation = value;
  },
};

vi.mock("@/lib/storage/backend", () => {
  // The routes under test construct this backend, but every tile read goes
  // through the mocked `getTileData` above — only the constructor runs.
  // vitest 5 forwards `new` to the implementation, so each of these must be
  // a constructible regular function, not an arrow.
  const HuggingFaceChunkBackend = vi.fn();
  // trace/twi/watershed/streams gate on a known starting elevation before
  // running — satisfy the gate so the hydrologic paths execute.
  const OZT2HuggingFaceBackend = vi.fn(function OZT2HuggingFaceBackend() {
    return {
      getElevation: () =>
        gateState.ozt2Rejects
          ? Promise.reject(new Error("hf ozt2 unavailable"))
          : Promise.resolve(gateState.ozt2Elevation),
    };
  });
  return { HuggingFaceChunkBackend, OZT2HuggingFaceBackend };
});

vi.mock("@/lib/point-elevation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/point-elevation")>();
  const real = actual.getPointElevation;
  const gated: typeof real = (lat, lon, storage) => {
    switch (gateState.pointElevation) {
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

import { getTileData } from "@/lib/tile";

/**
 * The mocked `@/lib/tile` fetch seam, typed as a Vitest mock so suites can
 * install per-tile DEMs and assert on the calls.
 */
export const mockGetTileData = getTileData as unknown as Mock;

/**
 * Base URL used by the request builders. The routes under test only read
 * url/method/body, so the host is immaterial — it is a loopback address so
 * no request can ever reach a real network peer.
 */
export const GET_URL = "http://localhost/api/test";

/**
 * Build a `NextRequest` from a plain `Request`.
 *
 * Route handlers are typed against NextRequest; the routes under test only
 * read url/method/body, so a plain Request cast suffices.
 */
export function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

/**
 * Build a 256×256 Int16 DEM from a per-cell fill function.
 *
 * Local tile builders — the vi.mock factory's own builder is not in scope
 * here, and the degradation tests need tiles other than the ramp.
 */
export function buildTile(fill: (row: number, col: number) => number): Int16Array {
  const t = new Int16Array(256 * 256);
  for (let r = 0; r < 256; r++) {
    for (let c = 0; c < 256; c++) {
      t[r * 256 + c] = fill(r, c);
    }
  }
  return t;
}

/**
 * Deterministic east-facing ramp (500 m + column phase) — every cell has
 * data, so slope and aspect are non-trivial.
 */
export const rampTile = (): Int16Array => buildTile((_r, c) => 500 + (c % 64));

/**
 * All-nodata DEM (SRTM's -32768 sentinel) for the "no data here" arms.
 */
export const nodataTile = (): Int16Array => buildTile(() => -32768);

/**
 * Slippy-tile pixel math mirrored from @/lib/srtm/zoom-math.
 *
 * The builders below place gradients and nodata holes at exact tile pixels,
 * so a suite needs to know which tile — and which pixel inside it — a pour
 * point resolves to.
 */
export function pourPixel(lat: number, lon: number, zoom = 10): { tx: number; ty: number; lx: number; ly: number } {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const worldX = ((lon + 180) / 360) * n * 256;
  const worldY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * 256;
  return { tx: Math.floor(worldX / 256), ty: Math.floor(worldY / 256), lx: worldX % 256, ly: worldY % 256 };
}

/**
 * Installs a per-tile getTileData: `build` returns a tile's DEM, or null to
 * reject it, so a suite can serve one tile and leave its neighbours missing.
 */
export function serveTiles(build: (z: number, tx: number, ty: number) => Int16Array | null): void {
  mockGetTileData.mockImplementation((z: number, tx: number, ty: number) => {
    const data = build(z, tx, ty);
    if (!data) return Promise.reject(new Error(`tile ${tx}/${ty} unavailable`));
    return Promise.resolve({ data, width: 256, height: 256, zoom: z });
  });
}

/**
 * Serves a single tile and rejects the rest — the isolation needed to watch a
 * flow walk run off the edge of the fetched window.
 */
export function serveOneTile(tx: number, ty: number, fill: (row: number, col: number) => number): void {
  serveTiles((_z, x, y) => (x === tx && y === ty ? buildTile(fill) : null));
}

/**
 * POST helper for the JSON-body terrain routes.
 */
export function postJSON(handler: PostHandler, body: unknown): Promise<Response> {
  return handler(
    makeRequest(GET_URL, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/**
 * Pour point picked for its tile-pixel position (see pourPixel):
 * 40.7 / -74.0 → tile 301/385, pixel (130.8, 13.4): away from tile edges.
 */
export const POUR_NORTH_EDGE = { lat: 41.50775, lon: -74.0 };

/**
 * Pour point even closer to the north edge than `POUR_NORTH_EDGE`:
 * 41.508269 / -74.0 → tile 301/382, pixel (130.8, 0.30) — nearer than one D8
 * *probe* step (0.67 px), so every northward neighbour lookup leaves the
 * served tile outright.
 */
export const POUR_NORTH_PROBE = { lat: 41.508269, lon: -74.0 };

/**
 * Pour point a few pixels from a tile's east edge (39.0 / -74.1878 → tile
 * 300/391, pixel (250.1, 90.0)), so an eastward walk runs out of tile.
 */
export const POUR_EAST_EDGE = { lat: 39.0, lon: -74.1878 };

/**
 * Mid-tile pour point (40.0 / -74.0 → tile 301/387, pixel (130.8, 170.3)),
 * used for the isolated-live-pixel cases.
 */
export const POUR_ISLAND = { lat: 40.0, lon: -74.0 };

/**
 * Mid-tile pour point (40.3 / -73.95 → tile 301/386, pixel (167.3, 140.5)),
 * used for the sea-level halt.
 */
export const POUR_MID_TILE = { lat: 40.3, lon: -73.95 };

/**
 * A tile whose only live pixel is the far corner of POUR_ISLAND's bilinear
 * stencil — every other cell in the surrounding 2×2 neighbourhoods is nodata.
 */
export function islandTile(): Int16Array {
  const pour = pourPixel(POUR_ISLAND.lat, POUR_ISLAND.lon);
  const tile = nodataTile();
  tile[(Math.floor(pour.ly) + 1) * 256 + (Math.floor(pour.lx) + 1)] = 32767;
  return tile;
}

/**
 * A DEM payload whose pixel reads throw a plain string. That is the only way to
 * reach the routes' `err instanceof Error ? err.message : "Unknown error"`
 * fallback, which reports the failure as a 502.
 */
export function hostileTileData(): Int16Array {
  return new Proxy(new Int16Array(256 * 256), {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) {
        // Intentionally a non-Error throw so the route's generic-message
        // fallback branch is exercised.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "tile payload exploded";
      }
      return Reflect.get(target, prop, receiver) as number;
    },
  });
}

/**
 * Adapter turning a prepared DEM into the `getTileData` implementation the
 * routes call — resolves the same tile for every request.
 */
export function resolveTile(
  data: Int16Array,
): () => Promise<{ data: Int16Array; width: number; height: number; zoom: number }> {
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

// ── slope — nodata, even-median and downsample arms ──────────────────────────

// Typed body readers keep the appended slope/profile suites off the unsafe-any
// lint path that the older suites predate. The older suites now use them too —
// each reader types only the fields its route's suites assert.

/** Summary statistics returned by the slope route. */
export interface SlopeStats {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  total_cells: number;
}

/** Response body shape of the slope route. */
export interface SlopeBody {
  units?: string;
  radius_cells?: number;
  zoom?: number;
  stats?: SlopeStats | null;
  grid?: Array<Array<number | null>>;
  error?: string;
}

/**
 * Read and type a slope route response body.
 */
export async function slopeBody(resp: Response): Promise<SlopeBody> {
  return (await resp.json()) as SlopeBody;
}

/** Response body shape of the aspect route. */
export interface AspectBody {
  units?: string;
  valid_cells?: number;
  direction_bins?: Record<string, number> | null;
  grid?: Array<Array<number | null>>;
  error?: string;
}

/**
 * Read and type an aspect route response body.
 */
export async function aspectBody(resp: Response): Promise<AspectBody> {
  return (await resp.json()) as AspectBody;
}

/** Response body shape of the profile route. */
export interface ProfileBody {
  start?: { lat: number; lon: number };
  num_points?: number;
  profile?: Array<{ elevation: number }>;
  stats?: { min: number; max: number; total_gain: number } | null;
  error?: string;
}

/**
 * Read and type a profile route response body.
 */
export async function profileBody(resp: Response): Promise<ProfileBody> {
  return (await resp.json()) as ProfileBody;
}

/** Response body shape of the trace route. */
export interface TraceBody {
  start?: number[];
  end?: number[];
  elevations?: number[];
  steps?: number;
  path?: Array<[number, number]>;
  start_elev?: number;
  end_elev?: number;
  total_distance?: number;
  geojson?: {
    type?: string;
    geometry?: { coordinates?: Array<[number, number]> };
    properties?: { steps?: number };
  };
  error?: string;
}

/**
 * Read and type a trace route response body.
 */
export async function traceBody(resp: Response): Promise<TraceBody> {
  return (await resp.json()) as TraceBody;
}

/** Response body shape of the TWI route. */
export interface TwiBody {
  units?: string;
  radius_cells?: number;
  stats?: { count: number; median: number; min: number; max: number } | null;
  grid?: Array<Array<number | null>>;
  error?: string;
}

/**
 * Read and type a TWI route response body.
 */
export async function twiBody(resp: Response): Promise<TwiBody> {
  return (await resp.json()) as TwiBody;
}

/** Response body shape of the watershed route. */
export interface WatershedBody {
  type?: string;
  pixels?: number;
  min_elev?: number | null;
  max_elev?: number | null;
  mean_elev?: number | null;
  boundary?: Array<[number, number]>;
  geojson?: {
    type?: string;
    features?: Array<{ geometry?: { type?: string } }>;
  };
  error?: string;
}

/**
 * Read and type a watershed route response body.
 */
export async function watershedBody(resp: Response): Promise<WatershedBody> {
  return (await resp.json()) as WatershedBody;
}

/** One GeoJSON stream feature: its centreline and cell count. */
export interface StreamsFeature {
  geometry: { coordinates: Array<[number, number]> };
  properties: { length_cells: number };
}

/** Response body shape of the streams route. */
export interface StreamsBody {
  type?: string;
  features?: StreamsFeature[];
  stats?: { stream_count: number; threshold: number; total_cells: number } | null;
  error?: string;
}

/**
 * Read and type a streams route response body.
 */
export async function streamsBody(resp: Response): Promise<StreamsBody> {
  return (await resp.json()) as StreamsBody;
}
