import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { unzlibSync } from "fflate";

/**
 * Tests for /api/elevation-color/[z]/[x]/[y] — hypsometric color-ramped tiles.
 *
 * Both cache layers are faked: the Cloudflare Cache API through a stubbed
 * `caches` global, and R2 through an in-memory map. DEM assembly is mocked at
 * `getTileData`. The suite walks every cache outcome (CF hit / stale CF entry /
 * R2 hit / R2 failure) plus the never-5xx fallback.
 */

const r2Store = vi.hoisted(() => new Map<string, ArrayBuffer>());

vi.mock("@/lib/tile", () => ({
  getTileData: vi.fn(() => Promise.resolve({ data: new Int16Array(256 * 256), width: 256, height: 256, zoom: 8 })),
  CACHE_TTL: { ELEVATION: 86400 },
}));

vi.mock("@/lib/storage/backend", () => ({
  HuggingFaceChunkBackend: vi.fn(),
}));

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

import { GET, OPTIONS } from "@/app/api/elevation-color/[z]/[x]/[y]/route";
import { getTileData } from "@/lib/tile";
import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";

const mockGetTileData = getTileData as ReturnType<typeof vi.fn>;
const mockR2GetTile = r2GetTile as ReturnType<typeof vi.fn>;
const mockR2PutTile = r2PutTile as ReturnType<typeof vi.fn>;

const routeCtx = (z: string, x: string, y: string) => ({ params: Promise.resolve({ z, x, y }) });

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

interface CfCache {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

interface CfCacheStub {
  open: ReturnType<typeof vi.fn>;
  caches: CfCache[];
  putCalls: string[];
}

/**
 * Stub the Cloudflare Cache API. `open` is called once for the lookup and once
 * more for the write-back on every request that reaches generation.
 */
function stubCfCache(options: {
  entry?: Response | null;
  matchThrows?: boolean;
  openThrowsOn?: Array<"lookup" | "write">;
} = {}): CfCacheStub {
  const caches: CfCache[] = [];
  const putCalls: string[] = [];
  let openCount = 0;

  const open = vi.fn((): Promise<CfCache> => {
    const nth = openCount++;
    const phase = nth === 0 ? "lookup" : "write";
    if (options.openThrowsOn?.includes(phase)) {
      return Promise.reject(new Error("Cache API unavailable"));
    }
    const cache: CfCache = {
      match: vi.fn(() => {
        if (options.matchThrows) return Promise.reject(new Error("cache match failed"));
        return Promise.resolve(options.entry ?? null);
      }),
      put: vi.fn((key: string) => {
        putCalls.push(key);
        return Promise.resolve();
      }),
    };
    caches.push(cache);
    return Promise.resolve(cache);
  });

  vi.stubGlobal("caches", { open });
  return { open, caches, putCalls };
}

function pngBytes(size = 8): ArrayBuffer {
  return new Uint8Array(size).fill(7).buffer;
}

function cachedResponse(bytes: ArrayBuffer, cachedAt: number): Response {
  return new Response(bytes, {
    headers: { "Content-Type": "image/png", "x-cached-at": String(cachedAt) },
  });
}

/** Decode the route's filter-none 8-bit RGB PNG into pixels. */
function decodePng(bytes: Uint8Array, width: number, height: number): Array<[number, number, number]> {
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === "IDAT") idat.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const total = idat.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of idat) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }

  const raw = unzlibSync(compressed);
  const pixels: Array<[number, number, number]> = [];
  const stride = 1 + width * 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const off = y * stride + 1 + x * 3;
      pixels.push([raw[off], raw[off + 1], raw[off + 2]]);
    }
  }
  return pixels;
}

beforeEach(() => {
  r2Store.clear();
  mockGetTileData.mockReset();
  mockGetTileData.mockImplementation(() =>
    Promise.resolve({
      data: new Int16Array(8 * 8).fill(500),
      width: 8,
      height: 8,
      zoom: 8,
    }),
  );
  mockR2GetTile.mockClear();
  mockR2PutTile.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Elevation color API validation (/api/elevation-color)", () => {
  it("rejects non-numeric tile coordinates with 400", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/abc/1/1"), routeCtx("abc", "1", "1"));
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Invalid tile coordinates");
  });

  it("rejects zoom outside the supported 0-14 range with 400", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/15/1/1"), routeCtx("15", "1", "1"));
    expect(resp.status).toBe(400);
  });

  it("strips the .png extension from the y segment", async () => {
    stubCfCache();
    const resp = await GET(
      new NextRequest("http://localhost/api/elevation-color/8/100/60.png"),
      routeCtx("8", "100", "60.png"),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
  });

  it("exposes CORS preflight", async () => {
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

describe("Elevation color API cache layers", () => {
  it("serves a fresh Cloudflare Cache API hit without touching R2 or the DEM", async () => {
    const bytes = pngBytes(16);
    stubCfCache({ entry: cachedResponse(bytes, Date.now()) });

    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/8/100/60"), routeCtx("8", "100", "60"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("Content-Length")).toBe("16");
    expect(new Uint8Array(await resp.arrayBuffer())).toEqual(new Uint8Array(16).fill(7));
    expect(mockR2GetTile).not.toHaveBeenCalled();
    expect(mockGetTileData).not.toHaveBeenCalled();
  });

  it("serves a Cloudflare Cache hit that carries no timestamp", async () => {
    stubCfCache({ entry: new Response(pngBytes(4), { headers: { "Content-Type": "image/png" } }) });

    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/8/100/60"), routeCtx("8", "100", "60"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
  });

  it("ignores a stale Cloudflare Cache entry and falls through to R2", async () => {
    const cf = stubCfCache({ entry: cachedResponse(pngBytes(32), Date.now() - 4 * 3600 * 1000) });
    const bytes = pngBytes(32);
    r2Store.set("8/100/60", bytes);

    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/8/100/60"), routeCtx("8", "100", "60"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(mockR2GetTile).toHaveBeenCalledWith("elevation-color", 8, 100, 60);
    // The R2 hit is written back into the edge cache
    await vi.waitFor(() => { expect(cf.putCalls.length).toBeGreaterThan(0); });
    expect(cf.putCalls[0]).toBe("/api/elevation-color/8/100/60");
  });

  it("serves an R2 hit when the edge cache has no entry", async () => {
    stubCfCache();
    const bytes = pngBytes(24);
    r2Store.set("8/100/60", bytes);

    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/8/100/60"), routeCtx("8", "100", "60"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("Content-Length")).toBe("24");
    expect(mockGetTileData).not.toHaveBeenCalled();
  });

  it("falls through to generation when the R2 read throws", async () => {
    stubCfCache();
    mockR2GetTile.mockRejectedValueOnce(new Error("R2 unavailable"));

    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/8/100/60"), routeCtx("8", "100", "60"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(mockGetTileData).toHaveBeenCalled();
  });

  it("tolerates a failing edge-cache read and a failing edge-cache write", async () => {
    stubCfCache({ matchThrows: true, openThrowsOn: ["write"] });

    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/8/100/60"), routeCtx("8", "100", "60"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    await vi.waitFor(() => { expect(mockR2PutTile).toHaveBeenCalled(); });
  });
});

describe("Elevation color API generation", () => {
  it("renders a color-ramped PNG on a miss and writes both caches", async () => {
    const cf = stubCfCache();

    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/8/100/60"), routeCtx("8", "100", "60"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Tile-Type")).toBe("elevation-color");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Cache-Control")).toContain("max-age=3600");
    expect(mockGetTileData).toHaveBeenCalledWith(8, 100, 60, expect.anything());

    const bytes = new Uint8Array(await resp.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_SIGNATURE);
    expect(resp.headers.get("Content-Length")).toBe(String(bytes.byteLength));

    await vi.waitFor(() => { expect(mockR2PutTile.mock.calls.length).toBeGreaterThan(0); });
    expect(mockR2PutTile.mock.calls[0].slice(0, 4)).toEqual(["elevation-color", 8, 100, 60]);
    expect(cf.putCalls[0]).toBe("/api/elevation-color/8/100/60");

    // 500m of uniform elevation lands between the 200m and 800m ramp stops
    const pixels = decodePng(bytes, 8, 8);
    expect(new Set(pixels.map((p) => p.join(","))).size).toBe(1);
    const [r, g, b] = pixels[0];
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("renders NoData cells as the dark ocean color", async () => {
    stubCfCache();
    const data = new Int16Array(8 * 8).fill(-32768);
    mockGetTileData.mockImplementation(() => Promise.resolve({ data, width: 8, height: 8, zoom: 8 }));

    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/8/100/60"), routeCtx("8", "100", "60"));
    const bytes = new Uint8Array(await resp.arrayBuffer());
    expect(decodePng(bytes, 8, 8)[0]).toEqual([5, 12, 30]);
  });

  it("returns 200 with an ocean-colored fallback tile when assembly fails (never 5xx)", async () => {
    stubCfCache();
    mockGetTileData.mockRejectedValueOnce(new Error("chunk not found"));

    const resp = await GET(new NextRequest("http://localhost/api/elevation-color/8/100/60"), routeCtx("8", "100", "60"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Tile-Type")).toBe("fallback-ocean");

    const bytes = new Uint8Array(await resp.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual(PNG_SIGNATURE);
    // The fallback grid is zero-filled → every pixel is the sea-level ocean blue
    expect(decodePng(bytes, 256, 256)[0]).toEqual([8, 48, 107]);
    expect(mockR2PutTile).not.toHaveBeenCalled();
  });
});
