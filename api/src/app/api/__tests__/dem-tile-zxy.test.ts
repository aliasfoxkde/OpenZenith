import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unzlibSync } from "fflate";
import { mockRequest, bodyAs } from "./helpers";

/** 400 rejection body served by GET /api/dem-tile/{z}/{x}/{y}. */
interface DemTileErrorBody {
  error: string;
}

vi.mock("@/lib/tile", () => ({
  getTileData: vi.fn().mockResolvedValue({
    data: new Int16Array(256 * 256).fill(100),
    width: 256,
    height: 256,
  }),
}));

const route = () => import("@/app/api/dem-tile/[z]/[x]/[y]/route");

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

  it("returns 502 when PNG assembly fails", async () => {
    // getTileData answers all-NODATA (HTTP 200) for genuine ocean/out-of-coverage,
    // so a thrown error here means assembly itself failed.
    vi.mocked(vi.mocked(await import("@/lib/tile")).getTileData).mockRejectedValueOnce(new Error("chunk not found"));

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx("4", "8", "5.png"));
    expect(resp.status).toBe(502);
    expect((await bodyAs<DemTileErrorBody>(resp)).error).toBe("Failed to assemble DEM tile");
  });

  it("returns 404 for integer coordinates outside the 2^z grid", async () => {
    const { GET } = await route();
    // z=4 allows x,y in 0..15
    const resp = await GET(mockRequest("/api/dem-tile/4/99/99.png"), ctx("4", "99", "99.png"));
    expect(resp.status).toBe(404);
    expect((await bodyAs<DemTileErrorBody>(resp)).error).toBe("Tile out of range for zoom 4 (max 15)");
  });
});

describe("DEM Tile XYZ API — params, zoom bounds and format selection", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response(null, { status: 404 }))),
    );
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
    expect((await bodyAs<DemTileErrorBody>(resp)).error).toBe("Zoom must be between 0 and 14");
  });

  it("rejects a non-numeric y coordinate with and without the .png suffix", async () => {
    const { GET } = await route();
    const withSuffix = await GET(mockRequest("/api/dem-tile/4/0/abc.png"), ctx(4, 0, "abc.png"));
    const withoutSuffix = await GET(mockRequest("/api/dem-tile/4/0/abc"), ctx(4, 0, "abc"));
    expect(withSuffix.status).toBe(400);
    expect(withoutSuffix.status).toBe(400);
    expect((await bodyAs<DemTileErrorBody>(withoutSuffix)).error).toBe("Invalid tile coordinates");
  });

  it("serves an explicit ?format=png request from HuggingFace", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png?format=png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Content-Length")).toBe(String((await resp.arrayBuffer()).byteLength));
  });

  it("serves an OZT2 tile straight from the HuggingFace dataset", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(new Response(asciiBuf("ozt2-tile-bytes"), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/10/163/395?format=ozt2"), ctx(10, 163, 395));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("ozt2");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Content-Length")).toBe(String("ozt2-tile-bytes".length));
    expect(await resp.arrayBuffer()).toEqual(asciiBuf("ozt2-tile-bytes"));
    expect(fetchMock.mock.calls[0]![0]).toBe(
      // bounds: the route fetched once
      "https://huggingface.co/datasets/aliasfox/srtm30m-ozt2-v2/resolve/main/tiles/z10/163/395.ozt2",
    );
  });

  it("falls back to a PNG (and says so) when no OZT2 tile exists upstream", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/10/163/395?format=ozt2"), ctx(10, 163, 395));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Dem-Tile-Format-Fallback")).toBe("ozt2-to-png");
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
  });

  it("still falls back to a PNG when the OZT2 fetch fails, warning in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const logSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL) => Promise.reject(new Error("HF unavailable"))),
    );

    try {
      const { GET } = await route();
      const resp = await GET(mockRequest("/api/dem-tile/10/163/395?format=ozt2"), ctx(10, 163, 395));
      expect(resp.status).toBe(200);
      expect(resp.headers.get("X-Dem-Tile-Format-Fallback")).toBe("ozt2-to-png");
      expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("OZT2 tile not found for 10/163/395"));
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

  it("writes assembled tiles back to the Cloudflare cache", async () => {
    const cachesMock = stubCaches();
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");

    await vi.waitFor(() => {
      expect(cachesMock.puts.length).toBe(1);
    });
    expect(cachesMock.puts[0]!.key).toBe("/api/dem-tile/4/8/5?fmt=png&enc=terrarium"); // bounds: length 1 asserted above
    expect(cachesMock.puts[0]!.bytes).toBeGreaterThan(0);
  });
});

describe("DEM Tile XYZ API — Cloudflare edge cache", () => {
  beforeEach(async () => {
    vi.mocked(vi.mocked(await import("@/lib/tile")).getTileData)
      .mockReset()
      .mockResolvedValue({
        data: new Int16Array(256 * 256).fill(100),
        width: 256,
        height: 256,
        zoom: 4,
      });
  });

  it("serves a fresh PNG entry from the edge cache", async () => {
    const cachesMock = stubCaches({
      "/api/dem-tile/4/8/5?fmt=png&enc=terrarium": { body: asciiBuf("edge-png"), cachedAt: String(Date.now()) },
    });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("cf-cache");
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("png");
    expect(cachesMock.match).toHaveBeenCalledWith("/api/dem-tile/4/8/5?fmt=png&enc=terrarium");
    expect(await resp.arrayBuffer()).toEqual(asciiBuf("edge-png"));
  });

  it("serves an OZT2 entry from a format-specific edge cache key", async () => {
    const cachesMock = stubCaches({
      "/api/dem-tile/10/163/395?fmt=ozt2&enc=terrarium": { body: asciiBuf("edge-ozt2"), cachedAt: String(Date.now()) },
    });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/10/163/395?format=ozt2"), ctx(10, 163, 395));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("cf-cache");
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("ozt2");
    expect(resp.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(cachesMock.match).toHaveBeenCalledWith("/api/dem-tile/10/163/395?fmt=ozt2&enc=terrarium");
  });

  it("reassembles when an entry carries no x-cached-at timestamp", async () => {
    // Undated entries have unknown write age — serving them unconditionally
    // allowed unbounded staleness. They must be treated as expired.
    stubCaches({ "/api/dem-tile/4/8/5?fmt=png&enc=terrarium": { body: asciiBuf("undated-png") } });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
  });

  it("ignores an entry older than the immutable TTL and reassembles the tile", async () => {
    // 400 days — past the 1y immutable window the route now enforces.
    const stale = String(Date.now() - 400 * 24 * 60 * 60 * 1000);
    stubCaches({
      "/api/dem-tile/4/8/5?fmt=png&enc=terrarium": { body: asciiBuf("stale-png"), cachedAt: stale },
    });

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
    await vi.waitFor(() => {
      expect(open).toHaveBeenCalledTimes(2);
    });
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
    await vi.waitFor(() => {
      expect(put).toHaveBeenCalledTimes(1);
    });
  });
});

describe("DEM Tile XYZ API — pixel encoding", () => {
  /** Decode a response's PNG IDAT back into raw scanlines. */
  async function scanlines(resp: Response): Promise<Uint8Array> {
    const png = new Uint8Array(await resp.arrayBuffer());
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const idat: Uint8Array[] = [];
    for (let off = 8; off < png.length;) {
      const length = view.getUint32(off);
      // bounds: every PNG chunk carries an 8-byte header, so off+4..off+7 are in range
      const type = String.fromCharCode(png[off + 4]!, png[off + 5]!, png[off + 6]!, png[off + 7]!);
      if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + length));
      off += 12 + length;
    }
    return unzlibSync(
      idat.reduce((acc, chunk) => {
        const joined = new Uint8Array(acc.length + chunk.length);
        joined.set(acc);
        joined.set(chunk, acc.length);
        return joined;
      }, new Uint8Array(0)),
    );
  }

  /** Terrarium decode of the scanline pixel at (px, py). */
  const terrariumAt = (raw: Uint8Array, width: number, px: number, py: number): number => {
    const off = py * (1 + width * 3) + 1 + px * 3;
    // bounds: each scanline is 1 + width*3 filter+pixel bytes and px < width
    return raw[off]! * 256 + raw[off + 1]! + raw[off + 2]! / 256 - 32768;
  };

  /** Terrain-RGB decode of the scanline pixel at (px, py). */
  const terrainRgbAt = (raw: Uint8Array, width: number, px: number, py: number): number => {
    const off = py * (1 + width * 3) + 1 + px * 3;
    // bounds: each scanline is 1 + width*3 filter+pixel bytes and px < width
    return (raw[off]! * 65536 + raw[off + 1]! * 256 + raw[off + 2]!) / 10 - 10000;
  };

  beforeEach(async () => {
    // NODATA, a negative land height and a positive one — enough to tell the
    // two encodings apart, since they disagree on every one of these.
    vi.mocked(vi.mocked(await import("@/lib/tile")).getTileData)
      .mockReset()
      .mockResolvedValue({
        data: new Int16Array([-32768, -40, 0, 8848]),
        width: 2,
        height: 2,
        zoom: 4,
      });
  });

  it("keeps the default response byte-identical to the Terrarium encoder", async () => {
    const { GET } = await route();
    const { encodeTerrariumPNG } = await import("@/lib/terrarium-png");
    const expected = encodeTerrariumPNG(new Int16Array([-32768, -40, 0, 8848]), 2, 2);

    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    expect(resp.status).toBe(200);
    expect(await resp.arrayBuffer()).toEqual(expected.buffer as ArrayBuffer);
  });

  it("carries the encoding header on both the default and the explicit request", async () => {
    const { GET } = await route();
    for (const search of ["", "?encoding=terrarium"]) {
      const resp = await GET(mockRequest(`/api/dem-tile/4/8/5.png${search}`), ctx(4, 8, "5.png"));
      expect(resp.headers.get("X-Dem-Tile-Encoding")).toBe("terrarium");
    }
  });

  it("serves Mapbox Terrain-RGB without changing content type or tile headers", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png?encoding=mapbox"), ctx(4, 8, "5.png"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("Cache-Control")).toContain("immutable");
    expect(resp.headers.get("X-Dem-Tile-Format")).toBe("png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
    expect(resp.headers.get("X-Dem-Tile-Encoding")).toBe("mapbox");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Content-Length")).toBe(String((await resp.clone().arrayBuffer()).byteLength));
  });

  it("encodes the same grid as Terrain-RGB when asked", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png?encoding=mapbox"), ctx(4, 8, "5.png"));
    const raw = await scanlines(resp);

    // NODATA has no representation in Terrain-RGB: it collapses onto code 0,
    // which decodes as -10,000 m.
    expect(terrainRgbAt(raw, 2, 0, 0)).toBe(-10000);
    expect(terrainRgbAt(raw, 2, 1, 0)).toBeCloseTo(-40, 1);
    expect(terrainRgbAt(raw, 2, 0, 1)).toBeCloseTo(0, 1);
    expect(terrainRgbAt(raw, 2, 1, 1)).toBeCloseTo(8848, 1);
  });

  it("leaves the Terrarium decoding of the default tile untouched", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    const raw = await scanlines(resp);
    expect(terrariumAt(raw, 2, 0, 0)).toBe(-32768); // NODATA keeps its zero code
    expect(terrariumAt(raw, 2, 1, 0)).toBe(-40);
    expect(terrariumAt(raw, 2, 1, 1)).toBe(8848);
  });

  it("caches the two encodings under separate keys", async () => {
    const cachesMock = stubCaches();
    const { GET } = await route();
    await GET(mockRequest("/api/dem-tile/4/8/5.png"), ctx(4, 8, "5.png"));
    await GET(mockRequest("/api/dem-tile/4/8/5.png?encoding=mapbox"), ctx(4, 8, "5.png"));

    await vi.waitFor(() => {
      expect(cachesMock.puts.length).toBe(2);
    });
    expect(cachesMock.puts.map((put) => put.key).sort()).toEqual([
      "/api/dem-tile/4/8/5?fmt=png&enc=mapbox",
      "/api/dem-tile/4/8/5?fmt=png&enc=terrarium",
    ]);
  });

  it("serves a Mapbox entry from its own edge cache key", async () => {
    stubCaches({
      "/api/dem-tile/4/8/5?fmt=png&enc=mapbox": { body: asciiBuf("edge-mapbox"), cachedAt: String(Date.now()) },
    });

    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png?encoding=mapbox"), ctx(4, 8, "5.png"));
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("cf-cache");
    expect(resp.headers.get("X-Dem-Tile-Encoding")).toBe("mapbox");
    expect(await resp.arrayBuffer()).toEqual(asciiBuf("edge-mapbox"));
  });

  it("rejects an unknown encoding rather than falling back to Terrarium", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png?encoding=quantized-mesh"), ctx(4, 8, "5.png"));
    expect(resp.status).toBe(400);
    expect((await bodyAs<DemTileErrorBody>(resp)).error).toBe("encoding must be 'terrarium' or 'mapbox'");
  });

  it("rejects encoding=mapbox alongside format=ozt2, which has no pixel encoding", async () => {
    const { GET } = await route();
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5?format=ozt2&encoding=mapbox"), ctx(4, 8, "5"));
    expect(resp.status).toBe(400);
    expect((await bodyAs<DemTileErrorBody>(resp)).error).toContain("requires format=png");
  });
});
