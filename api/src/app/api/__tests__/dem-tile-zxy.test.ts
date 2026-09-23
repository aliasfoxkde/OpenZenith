import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockRequest } from "./helpers";

vi.mock("@/lib/tile", () => ({
  getTileData: vi.fn().mockResolvedValue({
    data: new Int16Array(256 * 256).fill(100),
    width: 256,
    height: 256,
  }),
}));

const route = () => import("@/app/api/dem-tile/[z]/[x]/[y]/route");
const r2Cache = () => import("@/lib/storage/r2-tile-cache");

const ctx = (z: number | string, x: number | string, y: number | string) => ({
  params: Promise.resolve({ z: String(z), x: String(x), y: String(y) }),
});

const asciiBuf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

/** A Cloudflare Cache API double backed by a plain object. */
function stubCaches(entries: Record<string, { body: ArrayBuffer; cachedAt?: string } | undefined> = {}) {
  const puts: Array<{ key: string; bytes: number }> = [];
  const match = vi.fn((key: string) => {
    const entry = entries[key];
    if (!entry) return undefined;
    const headers = new Headers({ "Content-Type": "image/png" });
    if (entry.cachedAt !== undefined) headers.set("x-cached-at", entry.cachedAt);
    return new Response(entry.body, { headers });
  });
  const put = vi.fn(async (key: string, stored: Response) => {
    puts.push({ key, bytes: (await stored.arrayBuffer()).byteLength });
  });
  const open = vi.fn(() => Promise.resolve({ match, put }));
  vi.stubGlobal("caches", { open });
  const handle = { open, match, put, puts };
  return handle;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("DEM Tile XYZ API", () => {
  it("returns a PNG tile for valid coordinates", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx("4", "8", "5.png"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
  });

  it("rejects invalid zoom level", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/99/0/0.png"), ctx("99", "0", "0.png"));
    expect(resp.status).toBe(400);
  });

  it("rejects non-numeric coordinates", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/abc/5.png"), ctx("4", "abc", "5.png"));
    expect(resp.status).toBe(400);
  });

  it("returns fallback ocean tile on assembly error", async () => {
    vi.mocked(vi.mocked(await import("@/lib/tile")).getTileData).mockRejectedValueOnce(new Error("chunk not found"));

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx("4", "8", "5.png"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("fallback-ocean");
  });
});

describe("DEM Tile XYZ API — params, zoom bounds and format selection", () => {
  beforeEach(async () => {
    const { r2GetTile, r2PutTile } = await r2Cache();
    vi.mocked(r2GetTile).mockReset().mockResolvedValue(null);
    vi.mocked(r2PutTile).mockReset().mockResolvedValue(undefined);
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await route();
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("accepts the zoom range boundaries 0 and 14", async () => {
    const { GET } = await route();
    for (const zoom of [0, 14]) {
      const resp = await GET(mockRequest(`/api/dem-tile/${zoom}/0/0.png`), ctx(zoom, 0, "0.png"));
      expect(resp.status).toBe(200);
      expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    }
  });

  it("rejects a negative zoom level", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/-1/0/0.png"), ctx(-1, 0, "0.png"));
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toBe("Invalid zoom level");
  });

  it("rejects a non-numeric y coordinate with and without the .png suffix", async () => {
    const { GET } = await route();
    const withSuffix = await GET(mockRequest("/api/dem-tile/4/0/abc.png"), ctx(4, 0, "abc.png"));
    const withoutSuffix = await GET(mockRequest("/api/dem-tile/4/0/abc"), ctx(4, 0, "abc"));
    expect(withSuffix.status).toBe(400);
    expect(withoutSuffix.status).toBe(400);
    expect((await withoutSuffix.json()).error).toBe("Invalid tile coordinates");
  });

  it("serves an explicit ?format=png request from HuggingFace", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png?format=png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Content-Length")).toBe(String((await resp.arrayBuffer()).byteLength));
  });

  it("serves an OZT2 tile straight from R2", async () => {
    const { r2GetTile } = await r2Cache();
    vi.mocked(r2GetTile).mockReset().mockImplementation((prefix: string) =>
      Promise.resolve(prefix === "ozt2" ? asciiBuf("ozt2-tile-bytes") : null),
    );

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/10/163/395?format=ozt2"), ctx(10, 163, 395));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("r2-cache");
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("ozt2");
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("Content-Length")).toBe(String("ozt2-tile-bytes".length));
    expect(await resp.arrayBuffer()).toEqual(asciiBuf("ozt2-tile-bytes"));
    expect(vi.mocked(r2GetTile).mock.calls[0][0]).toBe("ozt2");
  });

  it("falls back to a PNG (and says so) when no OZT2 tile exists in R2", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/10/163/395?format=ozt2"), ctx(10, 163, 395));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Dem-Tile-Format-Fallback")).toBe("ozt2-to-png");
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");

    const { r2GetTile } = await r2Cache();
    expect(vi.mocked(r2GetTile).mock.calls.map((call) => call[0])).toEqual(["ozt2", "dem-tile"]);
  });

  it("still falls back to a PNG when the OZT2 R2 read fails, logging in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { r2GetTile } = await r2Cache();
    vi.mocked(r2GetTile).mockReset().mockImplementation((prefix: string) =>
      prefix === "ozt2" ? Promise.reject(new Error("R2 unavailable")) : Promise.resolve(null),
    );

    try {
      const { GET } = await route();
      const resp = await GET(mockRequest("/api/dem-tile/10/163/395?format=ozt2"), ctx(10, 163, 395));
      expect(resp.status).toBe(200);
      expect(resp.headers.get("X-Dem-Tile-Format-Fallback")).toBe("ozt2-to-png");
      expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("OZT2 tile not found in R2 for 10/163/395"));
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not log the OZT2 fallback outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const { GET } = await route();
      await GET(mockRequest("/api/dem-tile/10/163/395?format=ozt2"), ctx(10, 163, 395));
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("serves a PNG tile from the R2 cache", async () => {
    const { r2GetTile } = await r2Cache();
    vi.mocked(r2GetTile).mockReset().mockImplementation((prefix: string) =>
      Promise.resolve(prefix === "dem-tile" ? asciiBuf("png-tile-bytes") : null),
    );

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("r2-cache");
    expect(resp.headers.get("X-Cache")).toBe("HIT");
  });

  it("falls through to HuggingFace assembly when the R2 read fails", async () => {
    const { r2GetTile } = await r2Cache();
    vi.mocked(r2GetTile).mockReset().mockRejectedValue(new Error("R2 unavailable"));

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
  });

  it("writes assembled tiles back to the Cloudflare cache", async () => {
    const cachesMock = stubCaches();
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");

    await vi.waitFor(() => { expect(cachesMock.puts.length).toBe(1); });
    expect(cachesMock.puts[0].key).toBe("/api/dem-tile/4/8/5?fmt=png");
    expect(cachesMock.puts[0].bytes).toBeGreaterThan(0);
  });
});

describe("DEM Tile XYZ API — Cloudflare edge cache", () => {
  beforeEach(async () => {
    const { r2GetTile, r2PutTile } = await r2Cache();
    vi.mocked(r2GetTile).mockReset().mockResolvedValue(null);
    vi.mocked(r2PutTile).mockReset().mockResolvedValue(undefined);
    vi.mocked(vi.mocked(await import("@/lib/tile")).getTileData).mockReset().mockResolvedValue({
      data: new Int16Array(256 * 256).fill(100),
      width: 256,
      height: 256,
      zoom: 4,
    });
  });

  it("serves a fresh PNG entry from the edge cache", async () => {
    const cachesMock = stubCaches({
      "/api/dem-tile/4/8/5?fmt=png": { body: asciiBuf("edge-png"), cachedAt: String(Date.now()) },
    });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("cf-cache");
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("png");
    expect(cachesMock.match).toHaveBeenCalledWith("/api/dem-tile/4/8/5?fmt=png");
    expect(await resp.arrayBuffer()).toEqual(asciiBuf("edge-png"));
  });

  it("serves an OZT2 entry from a format-specific edge cache key", async () => {
    const cachesMock = stubCaches({
      "/api/dem-tile/10/163/395?fmt=ozt2": { body: asciiBuf("edge-ozt2"), cachedAt: String(Date.now()) },
    });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/10/163/395?format=ozt2"), ctx(10, 163, 395));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("cf-cache");
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("ozt2");
    expect(resp.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(cachesMock.match).toHaveBeenCalledWith("/api/dem-tile/10/163/395?fmt=ozt2");
  });

  it("reassembles when an entry carries no x-cached-at timestamp", async () => {
    // Undated entries have unknown write age — serving them unconditionally
    // allowed unbounded staleness. They must be treated as expired.
    stubCaches({ "/api/dem-tile/4/8/5?fmt=png": { body: asciiBuf("undated-png") } });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
  });

  it("ignores an entry older than one hour and reassembles the tile", async () => {
    const stale = String(Date.now() - 4 * 60 * 60 * 1000);
    stubCaches({ "/api/dem-tile/4/8/5?fmt=png": { body: asciiBuf("stale-png"), cachedAt: stale } });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
  });

  it("keeps serving tiles when the Cache API is unavailable", async () => {
    vi.stubGlobal("caches", {
      open: vi.fn(() => Promise.reject(new Error("cache unavailable"))),
    });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
  });

  it("survives a failing cache write after a fresh assembly", async () => {
    const open = vi
      .fn()
      .mockResolvedValueOnce({
        match: vi.fn(() => Promise.resolve(undefined)),
        put: vi.fn(() => Promise.resolve(undefined)),
      })
      .mockRejectedValueOnce(new Error("cache write failed"));
    vi.stubGlobal("caches", { open });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    await vi.waitFor(() => { expect(open).toHaveBeenCalledTimes(2); });
  });

  it("keeps serving tiles when the cache write rejects asynchronously", async () => {
    const put = vi.fn(() => Promise.reject(new Error("quota exceeded")));
    vi.stubGlobal("caches", {
      open: vi.fn(() => Promise.resolve({ match: vi.fn(() => Promise.resolve(undefined)), put })),
    });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    await vi.waitFor(() => { expect(put).toHaveBeenCalledTimes(1); });
  });
});
