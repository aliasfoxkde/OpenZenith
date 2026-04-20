import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

vi.mock("@/lib/tile", () => ({
  getTileData: vi.fn().mockResolvedValue({
    data: new Int16Array(256 * 256).fill(100),
    width: 256,
    height: 256,
  }),
}));

vi.mock("@/lib/storage/r2-tile-cache", () => ({
  r2GetTile: vi.fn().mockResolvedValue(null),
  r2PutTile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/storage/cache", () => ({
  staleWhileRevalidate: vi.fn().mockResolvedValue(null),
}));

describe("DEM Tile XYZ API", () => {
  it("returns a PNG tile for valid coordinates", async () => {
    const { GET } = await import("@/app/api/dem-tile/[z]/[x]/[y]/route");
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), {
      params: Promise.resolve({ z: "4", x: "8", y: "5.png" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("huggingface");
  });

  it("rejects invalid zoom level", async () => {
    const { GET } = await import("@/app/api/dem-tile/[z]/[x]/[y]/route");
    const resp = await GET(mockRequest("/api/dem-tile/99/0/0.png"), {
      params: Promise.resolve({ z: "99", x: "0", y: "0.png" }),
    });
    expect(resp.status).toBe(400);
  });

  it("rejects non-numeric coordinates", async () => {
    const { GET } = await import("@/app/api/dem-tile/[z]/[x]/[y]/route");
    const resp = await GET(mockRequest("/api/dem-tile/4/abc/5.png"), {
      params: Promise.resolve({ z: "4", x: "abc", y: "5.png" }),
    });
    expect(resp.status).toBe(400);
  });

  it("returns fallback ocean tile on assembly error", async () => {
    vi.mocked(vi.mocked(await import("@/lib/tile")).getTileData).mockRejectedValueOnce(new Error("chunk not found"));

    const { GET } = await import("@/app/api/dem-tile/[z]/[x]/[y]/route");
    const resp = await GET(mockRequest("/api/dem-tile/4/8/5.png"), {
      params: Promise.resolve({ z: "4", x: "8", y: "5.png" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("X-Dem-Tile-Source")).toBe("fallback-ocean");
  });
});
