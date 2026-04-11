import { describe, it, expect, vi } from "vitest";

describe("Landcover Tile API", () => {
  it("proxies CORINE land cover WMS tiles", async () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(mockPng, { status: 200, headers: { "Content-Type": "image/png" } }),
    );

    const { GET } = await import("@/app/api/landcover/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/landcover/5/15/10"), {
      params: Promise.resolve({ z: "5", x: "15", y: "10" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("image/png");
    expect(resp.headers.get("Cache-Control")).toContain("max-age");
  });

  it("returns error for out of range zoom", async () => {
    const { GET } = await import("@/app/api/landcover/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/landcover/0/0/0"), {
      params: Promise.resolve({ z: "0", x: "0", y: "0" }),
    });
    // CORINE land cover only covers zoom 3-13
    expect(resp.status).toBe(404);
  });
});
