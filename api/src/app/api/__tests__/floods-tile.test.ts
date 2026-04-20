import { describe, it, expect, vi } from "vitest";

describe("Floods Tile API", () => {
  it("proxies GIBS VIIRS flood WMS tiles", async () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(mockPng, { status: 200, headers: { "Content-Type": "image/png" } }),
    );

    const { GET } = await import("@/app/api/floods-tile/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/floods-tile/5/15/10"), {
      params: Promise.resolve({ z: "5", x: "15", y: "10" }),
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("image/png");
    expect(resp.headers.get("Cache-Control")).toContain("max-age=86400");
  });

  it("returns 400 for out of range zoom", async () => {
    const { GET } = await import("@/app/api/floods-tile/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/floods-tile/15/0/0"), {
      params: Promise.resolve({ z: "15", x: "0", y: "0" }),
    });
    expect(resp.status).toBe(400);
  });

  it("allows zoom 0 (min is 0)", async () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(mockPng, { status: 200, headers: { "Content-Type": "image/png" } }),
    );

    const { GET } = await import("@/app/api/floods-tile/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/floods-tile/0/0/0"), {
      params: Promise.resolve({ z: "0", x: "0", y: "0" }),
    });
    expect(resp.status).toBe(200);
  });

  it("returns 200 on upstream failure (never 5xx)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    const { GET } = await import("@/app/api/floods-tile/[z]/[x]/[y]/route");
    const resp = await GET(new Request("http://localhost/api/floods-tile/3/1/1"), {
      params: Promise.resolve({ z: "3", x: "1", y: "1" }),
    });
    expect(resp.status).toBe(200);
  });
});
