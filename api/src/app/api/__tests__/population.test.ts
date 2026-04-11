import { describe, it, expect, vi } from "vitest";

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
