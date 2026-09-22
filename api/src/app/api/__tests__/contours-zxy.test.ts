import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for /api/contours/[z]/[x]/[y] — marching-squares contour lines.
 *
 * DEM assembly (`getTileData`) and the R2 cache-aside pair are mocked so the
 * suite exercises validation, the contour generator, and the route's
 * never-5xx failure contract without touching HuggingFace or R2.
 */

const r2Store = vi.hoisted(() => new Map<string, ArrayBuffer>());

vi.mock("@/lib/tile", () => ({
  getTileData: vi.fn(() => Promise.resolve({ data: new Int16Array(256 * 256), width: 256, height: 256, zoom: 8 })),
  CACHE_TTL: { ELEVATION: 86400 },
}));

vi.mock("@/lib/storage/backend", () => {
  function HuggingFaceChunkBackend() {}
  return { HuggingFaceChunkBackend };
});

vi.mock("@/lib/storage/r2-tile-cache", () => ({
  r2GetTile: vi.fn((_prefix: string, z: number, x: number, y: number) =>
    Promise.resolve(r2Store.get(`${z}/${x}/${y}`) ?? null),
  ),
  r2PutTile: vi.fn((_prefix: string, z: number, x: number, y: number, buf: ArrayBuffer | Uint8Array) => {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    r2Store.set(
      `${z}/${x}/${y}`,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    return Promise.resolve();
  }),
}));

import { GET, OPTIONS } from "@/app/api/contours/[z]/[x]/[y]/route";
import { getTileData } from "@/lib/tile";
import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";

const mockGetTileData = getTileData as ReturnType<typeof vi.fn>;
const mockR2GetTile = r2GetTile as ReturnType<typeof vi.fn>;
const mockR2PutTile = r2PutTile as ReturnType<typeof vi.fn>;

const routeCtx = (z: string, x: string, y: string) => ({
  params: Promise.resolve({ z, x, y }),
});

/** 4x4 tile: a ramp rising east and south so contour lines cross the grid. */
function rampTile(): Int16Array {
  const t = new Int16Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      t[r * 4 + c] = r * 100 + c * 10;
    }
  }
  return t;
}

beforeEach(() => {
  r2Store.clear();
  mockGetTileData.mockReset();
  mockGetTileData.mockImplementation(() =>
    Promise.resolve({
      data: rampTile(),
      width: 4,
      height: 4,
      zoom: 8,
    }),
  );
  mockR2GetTile.mockClear();
  mockR2PutTile.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Contours API validation (/api/contours)", () => {
  it("rejects non-numeric tile coordinates with 400", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/contours/abc/1/1"), routeCtx("abc", "1", "1"));
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Invalid tile coordinates (z must be 4-14)");
    expect(mockGetTileData).not.toHaveBeenCalled();
  });

  it.each([3, 15])("rejects zoom %i outside the supported 4-14 range with 400", async (zoom) => {
    const resp = await GET(new NextRequest(`http://localhost/api/contours/${zoom}/1/1`), routeCtx(String(zoom), "1", "1"));
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toContain("z must be 4-14");
  });

  it("exposes CORS preflight", async () => {
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  });
});

describe("Contours API R2 cache-aside", () => {
  it("serves a cached GeoJSON body with X-Cache HIT", async () => {
    const cachedBody = JSON.stringify({ type: "FeatureCollection", features: [{ cached: true }] });
    r2Store.set("8/70/50", new TextEncoder().encode(cachedBody).buffer);

    const resp = await GET(new NextRequest("http://localhost/api/contours/8/70/50"), routeCtx("8", "70", "50"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("X-Tile-Type")).toBe("contours");
    expect(resp.headers.get("Content-Type")).toBe("application/geojson");
    const body = (await resp.json()) as { features: Array<{ cached: boolean }> };
    expect(body.features).toHaveLength(1);
    expect(mockGetTileData).not.toHaveBeenCalled();
  });

  it("falls through to generation when the R2 read throws", async () => {
    mockR2GetTile.mockRejectedValueOnce(new Error("R2 unavailable"));

    const resp = await GET(new NextRequest("http://localhost/api/contours/8/71/51"), routeCtx("8", "71", "51"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    const body = (await resp.json()) as { type: string };
    expect(body.type).toBe("FeatureCollection");
  });
});

describe("Contours API generation", () => {
  it("returns GeoJSON contour lines and writes the tile to R2 on a miss", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/contours/8/72/52"), routeCtx("8", "72", "52"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Content-Type")).toBe("application/geojson");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(mockGetTileData).toHaveBeenCalledWith(8, 72, 52, expect.anything());

    const body = (await resp.json()) as {
      type: string;
      features: Array<{ type: string; geometry: { type: string; coordinates: number[][] }; properties: { elevation: number; type: string } }>;
    };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features.length).toBeGreaterThan(0);
    for (const feature of body.features) {
      expect(feature.type).toBe("Feature");
      expect(feature.geometry.type).toBe("LineString");
      expect(feature.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
      // GeoJSON order is [lon, lat]
      expect(feature.geometry.coordinates[0]).toHaveLength(2);
      expect(feature.properties.type).toMatch(/major|minor/);
      expect(feature.properties.elevation).toBeGreaterThanOrEqual(0);
    }

    await vi.waitFor(() => { expect(mockR2PutTile).toHaveBeenCalled(); });
    expect(mockR2PutTile.mock.calls[0].slice(0, 4)).toEqual(["contours", 8, 72, 52]);
  });

  it("marks levels at the major interval as major contours", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/contours/10/72/52"), routeCtx("10", "72", "52"));
    const body = (await resp.json()) as { features: Array<{ properties: { elevation: number; type: string } }> };
    const majors = body.features.filter((f) => f.properties.type === "major");
    const minors = body.features.filter((f) => f.properties.type === "minor");
    expect(majors.length).toBeGreaterThan(0);
    expect(minors.length).toBeGreaterThan(0);
    for (const major of majors) {
      expect(major.properties.elevation % 200).toBe(0);
    }
  });

  it("returns an empty FeatureCollection when every cell is NoData", async () => {
    mockGetTileData.mockImplementation(() =>
      Promise.resolve({
        data: new Int16Array(16).fill(-32768),
        width: 4,
        height: 4,
        zoom: 8,
      }),
    );

    const resp = await GET(new NextRequest("http://localhost/api/contours/8/72/52"), routeCtx("8", "72", "52"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { type: string; features: unknown[] };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(0);
  });

  it("skips cells that touch a NoData corner", async () => {
    const data = rampTile();
    data[5] = -32768;
    mockGetTileData.mockImplementation(() => Promise.resolve({ data, width: 4, height: 4, zoom: 8 }));

    const resp = await GET(new NextRequest("http://localhost/api/contours/8/72/52"), routeCtx("8", "72", "52"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { features: unknown[] };
    expect(body.features.length).toBeGreaterThan(0);
  });

  it("drops contour levels whose segment set is too short to form a line", async () => {
    // Only one cell (bottom-right) crosses the level, producing a single
    // segment — too short to chain into a LineString.
    const data = new Int16Array(16);
    data[15] = 100;
    mockGetTileData.mockImplementation(() => Promise.resolve({ data, width: 4, height: 4, zoom: 10 }));

    const resp = await GET(new NextRequest("http://localhost/api/contours/10/72/52"), routeCtx("10", "72", "52"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { features: unknown[] };
    expect(body.features).toHaveLength(0);
  });

  it.each([
    [
      "ridge and saddle mix",
      [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0],
    ],
    [
      "diagonal staircase mix",
      [0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0],
    ],
  ])("extracts segments across every marching squares case (%s)", async (_name, pattern) => {
    // 0/1 pattern scaled to 0/200 so the 100m contour level cuts the grid
    mockGetTileData.mockImplementation(() =>
      Promise.resolve({
        data: Int16Array.from(pattern, (bit) => (bit === 1 ? 200 : 0)),
        width: 4,
        height: 4,
        zoom: 8,
      }),
    );

    const resp = await GET(new NextRequest("http://localhost/api/contours/8/72/52"), routeCtx("8", "72", "52"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      features: Array<{ properties: { elevation: number }; geometry: { coordinates: number[][] } }>;
    };
    const level100 = body.features.filter((f) => f.properties.elevation === 100);
    expect(level100.length).toBeGreaterThan(0);
    for (const feature of level100) {
      for (const [lon, lat] of feature.geometry.coordinates) {
        expect(Number.isFinite(lat)).toBe(true);
        expect(Number.isFinite(lon)).toBe(true);
      }
    }
  });

  it("selects a coarser interval at middle zooms", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/contours/6/72/52"), routeCtx("6", "72", "52"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    const body = (await resp.json()) as {
      features: Array<{ properties: { elevation: number; type: string } }>;
    };
    // Zoom 6 evaluates only the 0m and 200m levels with a 1000m major interval
    const elevations = body.features.map((f) => f.properties.elevation);
    expect(elevations).toContain(200);
    expect(elevations).not.toContain(100);
    for (const feature of body.features) {
      expect(feature.properties.type).toBe("minor");
    }
  });

  it("uses the coarsest interval below zoom 6", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/contours/4/72/52"), routeCtx("4", "72", "52"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { features: unknown[] };
    // Zoom 4 evaluates only the 0m level, where every cell is above the level
    expect(body.features).toHaveLength(0);
  });
});

describe("Contours API failure contract", () => {
  it("returns 200 with an empty GeoJSON FeatureCollection when assembly fails (never 5xx)", async () => {
    mockGetTileData.mockRejectedValueOnce(new Error("chunk not found"));

    const resp = await GET(new NextRequest("http://localhost/api/contours/8/72/52"), routeCtx("8", "72", "52"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/geojson");
    const body = (await resp.json()) as { type: string; features: unknown[] };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(0);
    expect(mockR2PutTile).not.toHaveBeenCalled();
  });
});
