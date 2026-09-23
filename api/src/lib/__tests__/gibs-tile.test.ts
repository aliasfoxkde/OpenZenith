import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGIBSHandler, OPTIONS_HANDLER, CORS_HEADERS, type GIBSLayerConfig } from "../gibs-tile";
import { tileToBboxString } from "../srtm/zoom-math";
import { r2GetTile } from "@/lib/storage/r2-tile-cache";

/**
 * Shared GIBS WMS proxy helper — exercised directly (the per-layer routes only
 * cover the happy path, leaving the 404 range guard, the R2 hit path, the
 * upstream-error path and the content-type fallback uncovered).
 */

const r2State = vi.hoisted(() => ({
  /** undefined → delegate to the real cache behaviour (null without a binding). */
  cached: undefined as ArrayBuffer | undefined,
  puts: [] as Array<{ type: string; z: number; x: number; y: number; bytes: number; contentType: string }>,
  rejectPut: false,
}));

vi.mock("@/lib/storage/r2-tile-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/r2-tile-cache")>();
  return {
    ...actual,
    r2GetTile: vi.fn((_type: string, _z: number, _x: number, _y: number) =>
      Promise.resolve(r2State.cached === undefined ? null : r2State.cached),
    ),
    r2PutTile: vi.fn((
      type: string,
      z: number,
      x: number,
      y: number,
      data: ArrayBuffer | Uint8Array,
      contentType: string,
    ): Promise<void> => {
      if (r2State.rejectPut) return Promise.reject(new Error("R2 write failed"));
      r2State.puts.push({ type, z, x, y, bytes: data.byteLength, contentType });
      return Promise.resolve();
    }),
  };
});

const CONFIG: GIBSLayerConfig = {
  layer: "MODIS_Terra_L3_NDVI_16Day",
  cachePrefix: "gibs-test",
  minZoom: 2,
  maxZoom: 5,
  cacheTtl: 43200,
};

const asciiBuf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

const pngResponse = (headers: Record<string, string> = {}): Response =>
  new Response(asciiBuf("png-bytes"), { status: 200, headers });

describe("createGIBSHandler — parameter validation", () => {
  const GET = createGIBSHandler(CONFIG);

  const call = (z: string, x: string, y: string) =>
    GET(new Request(`http://localhost/api/gibs/${z}/${x}/${y}`), {
      params: Promise.resolve({ z, x, y }),
    });

  it("rejects non-numeric coordinates with 400 and CORS headers", async () => {
    for (const coords of [
      { z: "abc", x: "0", y: "0" },
      { z: "3", x: "abc", y: "0" },
      { z: "3", x: "0", y: "abc" },
      // parseInt would silently accept these as 3 / 1 / 1e0
      { z: "3abc", x: "0", y: "0" },
      { z: "3", x: "1.5", y: "0" },
      { z: "3", x: "0", y: " " },
    ]) {
      const resp = await call(coords.z, coords.x, coords.y);
      expect(resp.status).toBe(400);
      expect(await resp.text()).toBe("Invalid tile coordinates");
      expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });

  it("rejects zoom below minZoom and above maxZoom with 400", async () => {
    expect((await call(String(CONFIG.minZoom - 1), "0", "0")).status).toBe(400);
    expect((await call(String(CONFIG.maxZoom + 1), "0", "0")).status).toBe(400);
  });

  it("returns 404 for a column outside 0..2^z-1", async () => {
    // z=3 → maxTile 7
    expect((await call("3", "8", "0")).status).toBe(404);
    expect((await call("3", "-1", "0")).status).toBe(404);
    expect(await (await call("3", "8", "0")).text()).toBe("Tile out of range");
  });

  it("returns 404 for a row outside 0..2^z-1", async () => {
    expect((await call("3", "0", "8")).status).toBe(404);
    expect((await call("3", "0", "-1")).status).toBe(404);
  });

  it("rejects a row outside the range even when the column is valid", async () => {
    expect((await call("2", "3", "4")).status).toBe(404);
  });

  it("accepts the range boundary maxTile = 2^z - 1 on both axes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pngResponse());
    const resp = await call("3", "7", "7");
    expect(resp.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createGIBSHandler — R2 cache", () => {
  const GET = createGIBSHandler(CONFIG);

  const call = (z: number, x: number, y: number) =>
    GET(new Request(`http://localhost/api/gibs/${z}/${x}/${y}`), {
      params: Promise.resolve({ z: String(z), x: String(x), y: String(y) }),
    });

  beforeEach(() => {
    vi.mocked(r2GetTile).mockClear();
    r2State.cached = undefined;
    r2State.rejectPut = false;
    r2State.puts = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves cached bytes from R2 without touching GIBS", async () => {
    r2State.cached = asciiBuf("cached-tile-bytes");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const resp = await call(3, 5, 3);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=43200");
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.arrayBuffer()).toEqual(asciiBuf("cached-tile-bytes"));

    const { r2GetTile: r2GetTileMock } = await import("@/lib/storage/r2-tile-cache");
    expect(vi.mocked(r2GetTileMock).mock.calls[0]).toEqual(["gibs-test", 3, 5, 3]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r2State.puts).toHaveLength(0);
  });

  it("propagates the configured cache TTL on a cache miss too", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pngResponse());
    const resp = await call(3, 5, 3);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=43200");
  });
});

describe("createGIBSHandler — WMS proxy", () => {
  const GET = createGIBSHandler(CONFIG);

  const call = (z: number, x: number, y: number) =>
    GET(new Request(`http://localhost/api/gibs/${z}/${x}/${y}`), {
      params: Promise.resolve({ z: String(z), x: String(x), y: String(y) }),
    });

  const wmsUrl = (z: number, x: number, y: number) =>
    `https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi` +
    `?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${CONFIG.layer}&FORMAT=image/png` +
    `&TRANSPARENT=TRUE&WIDTH=256&HEIGHT=256&CRS=EPSG:3857&BBOX=${tileToBboxString(z, x, y)}`;

  beforeEach(() => {
    r2State.cached = undefined;
    r2State.rejectPut = false;
    r2State.puts = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the configured layer and bbox for the tile and caches the bytes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pngResponse({ "Content-Type": "image/png" }));

    const resp = await call(2, 1, 2);
    expect(fetchSpy).toHaveBeenCalledWith(wmsUrl(2, 1, 2), {
      signal: expect.any(AbortSignal),
      headers: { "User-Agent": "OpenZenith/1.0" },
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(await resp.arrayBuffer()).toEqual(asciiBuf("png-bytes"));

    await vi.waitFor(() => {
      expect(r2State.puts).toHaveLength(1);
    });
    expect(r2State.puts[0]).toEqual({
      type: "gibs-test",
      z: 2,
      x: 1,
      y: 2,
      bytes: "png-bytes".length,
      contentType: "image/png",
    });
  });

  it("defaults to image/png when GIBS omits the content-type header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(asciiBuf("opaque-bytes")));
    const resp = await call(4, 2, 2);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    await vi.waitFor(() => {
      expect(r2State.puts).toHaveLength(1);
    });
    expect(r2State.puts[0].contentType).toBe("image/png");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("passes the upstream status through when GIBS cannot serve the tile", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("no imagery", { status: 503 }));

    const resp = await call(3, 0, 0);
    expect(resp.status).toBe(503);
    expect(await resp.text()).toBe("Tile not available");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(r2State.puts).toHaveLength(0);
  });

  it("returns 200 with a diagnostic body when the WMS request fails (silent-200)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network unreachable"));

    const resp = await call(3, 0, 0);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/plain;charset=UTF-8");
    expect(await resp.text()).toBe("Failed to fetch tile");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(r2State.puts).toHaveLength(0);
  });

  it("keeps serving the tile when the R2 write rejects", async () => {
    r2State.rejectPut = true;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(pngResponse());

    const resp = await call(3, 1, 1);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(await resp.arrayBuffer()).toEqual(asciiBuf("png-bytes"));
  });
});

describe("gibs-tile re-exports", () => {
  it("exposes the CORS preflight handler and headers for the route modules", () => {
    expect(CORS_HEADERS).toEqual({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });

    const resp = OPTIONS_HANDLER();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
  });
});
