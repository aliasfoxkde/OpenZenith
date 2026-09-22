import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for /api/tile/[z]/[x]/[y] — the raw Int16 DEM tile route.
 *
 * Named `tile-zxy` (not `tile`) so coverage dashboards keying on file names
 * don't mask this route behind `dem-tile`/`gebco-tile` substring matches.
 */

vi.mock("@/lib/tile", () => {
  const data = new Int16Array(256 * 256).fill(123);
  return {
    getTileData: vi.fn(async () => ({ data, width: 256, height: 256, zoom: 8 })),
    CACHE_TTL: { ELEVATION: 86400 },
  };
});

vi.mock("@/lib/storage/backend", () => {
  class HuggingFaceChunkBackend {}
  return { HuggingFaceChunkBackend };
});

const r2Store = new Map<string, ArrayBuffer>();

vi.mock("@/lib/storage/r2-tile-cache", () => ({
  r2GetTile: vi.fn(async (_prefix: string, z: number, x: number, y: number) => r2Store.get(`${z}/${x}/${y}`) ?? null),
  r2PutTile: vi.fn(async (_prefix: string, z: number, x: number, y: number, buf: ArrayBuffer) => {
    r2Store.set(`${z}/${x}/${y}`, buf);
  }),
}));

import { GET, OPTIONS } from "@/app/api/tile/[z]/[x]/[y]/route";
import { r2PutTile } from "@/lib/storage/r2-tile-cache";

const routeCtx = (z: number, x: number, y: number) => ({
  params: Promise.resolve({ z: String(z), x: String(x), y: String(y) }),
});

beforeEach(() => {
  r2Store.clear();
});

describe("Raw DEM tile API (/api/tile)", () => {
  it("serves 131072-byte Int16 tiles on miss", async () => {
    const resp = await GET(new Request("http://localhost/api/tile/8/72/96"), routeCtx(8, 72, 96));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(resp.headers.get("X-Tile-Size")).toBe("256");
    expect(resp.headers.get("X-Zoom")).toBe("8");
    expect(resp.headers.get("X-Cache")).toBe("MISS");
    const buf = await resp.arrayBuffer();
    expect(buf.byteLength).toBe(256 * 256 * 2);
  });

  it("serves from R2 cache on second request", async () => {
    await GET(new Request("http://localhost/api/tile/8/72/96"), routeCtx(8, 72, 96));
    // r2PutTile is fire-and-forget in the route — wait for the store write
    await vi.waitFor(() => expect(r2Store.size).toBe(1));
    const resp = await GET(new Request("http://localhost/api/tile/8/72/96"), routeCtx(8, 72, 96));
    expect(resp.headers.get("X-Cache")).toBe("HIT");
  });

  it("rejects non-integer coordinates with 400", async () => {
    const ctx = { params: Promise.resolve({ z: "abc", x: "1", y: "1" }) };
    const resp = await GET(new Request("http://localhost/api/tile/abc/1/1"), ctx);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("integers");
  });

  it("rejects out-of-range zoom with 400", async () => {
    const resp = await GET(new Request("http://localhost/api/tile/16/0/0"), routeCtx(16, 0, 0));
    expect(resp.status).toBe(400);
  });

  it("rejects tile indices beyond the zoom range with 400", async () => {
    // z=1 allows x,y in {0,1} only
    const resp = await GET(new Request("http://localhost/api/tile/1/5/0"), routeCtx(1, 5, 0));
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toContain("between 0 and 1");
  });

  it("returns 200 with error payload when assembly fails (never 5xx)", async () => {
    const { getTileData } = await import("@/lib/tile");
    (getTileData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("chunk not found"));
    const resp = await GET(new Request("http://localhost/api/tile/8/72/96"), routeCtx(8, 72, 96));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.error).toContain("chunk not found");
  });

  it("falls through to assembly when R2 read fails", async () => {
    const { r2GetTile } = await import("@/lib/storage/r2-tile-cache");
    (r2GetTile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("R2 down"));
    const resp = await GET(new Request("http://localhost/api/tile/8/73/96"), routeCtx(8, 73, 96));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Cache")).toBe("MISS");
  });

  it("exposes CORS preflight", async () => {
    const resp = await OPTIONS();
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeDefined();
  });
});
