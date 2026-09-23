import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { r2GetTile, r2PutTile } from "@/lib/storage/r2-tile-cache";

const route = () => import("@/app/api/population/[z]/[x]/[y]/route");

const ctx = (z: string, x: string, y: string) => ({ params: Promise.resolve({ z, x, y }) });
const req = (path: string) => new Request(`http://localhost:8788${path}`);

/** UTF-8 bytes as a real ArrayBuffer (no casts). */
function bytes(text: string): ArrayBuffer {
  const out = new ArrayBuffer(text.length);
  new Uint8Array(out).set(new TextEncoder().encode(text));
  return out;
}

describe("Population Tile API", () => {
  it("proxies GHSL population WMS tiles", async () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(mockPng, { status: 200, headers: { "Content-Type": "image/png" } }),
    );

    const { GET } = await import("@/app/api/population/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/population/5/15/10"), {
      params: Promise.resolve({ z: "5", x: "15", y: "10" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("image/png");
  });
});

describe("Population Tile API — param, cache and upstream branches", () => {
  beforeEach(() => {
    // Restore the setup-file baseline (cache miss, successful put).
    vi.mocked(r2GetTile).mockReset().mockResolvedValue(null);
    vi.mocked(r2PutTile).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await route();
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("rejects non-numeric and out-of-range zoom with 400", async () => {
    const { GET } = await route();
    for (const z of ["abc", "0", "9"]) {
      const resp = await GET(req(`/api/population/${z}/0/0`), ctx(z, "0", "0"));
      expect(resp.status, `zoom=${z}`).toBe(400);
      expect(await resp.text()).toBe("Invalid tile coordinates");
      expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });

  it("rejects non-numeric x and y with 400", async () => {
    const { GET } = await route();
    const badX = await GET(req("/api/population/5/abc/0"), ctx("5", "abc", "0"));
    const badY = await GET(req("/api/population/5/0/abc"), ctx("5", "0", "abc"));
    expect(badX.status).toBe(400);
    expect(badY.status).toBe(400);
  });

  it("returns 404 when a coordinate exceeds the zoom's tile range", async () => {
    const { GET } = await route();
    // zoom 1 → maxTile = 1
    const outOfRangeX = await GET(req("/api/population/1/2/0"), ctx("1", "2", "0"));
    const negativeY = await GET(req("/api/population/1/0/-1"), ctx("1", "0", "-1"));
    expect(outOfRangeX.status).toBe(404);
    expect(await outOfRangeX.text()).toBe("Tile out of range");
    expect(negativeY.status).toBe(404);
  });

  it("serves an R2 cache hit with X-Cache HIT and skips upstream", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("upstream", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const tile = bytes("cached-png");
    vi.mocked(r2GetTile).mockResolvedValue(tile);

    const { GET } = await route();
    const resp = await GET(req("/api/population/3/4/5"), ctx("3", "4", "5"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("HIT");
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resp.arrayBuffer()).toEqual(tile);
    expect(vi.mocked(r2GetTile).mock.calls[0]).toEqual(["population", 3, 4, 5]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the upstream content type and writes the tile to R2 on a miss", async () => {
    const tile = bytes("fresh-png");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(tile, { status: 200, headers: { "Content-Type": "image/png" } }),
    );

    const { GET } = await route();
    const resp = await GET(req("/api/population/3/4/5"), ctx("3", "4", "5"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(await resp.arrayBuffer()).toEqual(tile);
    expect(vi.mocked(r2PutTile).mock.calls[0]?.slice(0, 6)).toEqual([
      "population",
      3,
      4,
      5,
      tile,
      "image/png",
    ]);
  });

  it("falls back to image/png when upstream sends no content type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(bytes("opaque"), { status: 200 }));

    const { GET } = await route();
    const resp = await GET(req("/api/population/3/4/5"), ctx("3", "4", "5"));
    expect(resp.headers.get("Content-Type")).toBe("image/png");
  });

  it("propagates the upstream status when the tile is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("nope", { status: 503 }));

    const { GET } = await route();
    const resp = await GET(req("/api/population/3/4/5"), ctx("3", "4", "5"));
    expect(resp.status).toBe(503);
    expect(await resp.text()).toBe("Tile not available");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("answers 200 with a failure body when upstream fetch rejects", async () => {
    // Fake timers keep the route's 30s abort timer from holding the worker open.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));

    const { GET } = await route();
    const resp = await GET(req("/api/population/3/4/5"), ctx("3", "4", "5"));
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("Failed to fetch tile");
    expect(vi.mocked(r2PutTile)).not.toHaveBeenCalled();
  });
});
