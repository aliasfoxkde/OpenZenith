import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

describe("Proxy Tile API", () => {
  it("proxies tile from allowed host", async () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(mockPng, { status: 200, headers: { "Content-Type": "image/png" } }),
    );

    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=https://example.com/{z}/{x}/{y}.png&z=0&x=0&y=0"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("image/png");
  });

  it("returns transparent PNG on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not found", { status: 404 }));

    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=https://example.com/{z}/{x}/{y}.png&z=0&x=0&y=0"));
    expect(resp.status).toBe(200);
  });

  it("blocks disallowed host (SSRF protection)", async () => {
    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(
      mockRequest("/api/proxy/tile?url=https://internal-server.local/{z}/{x}/{y}.png&z=0&x=0&y=0"),
    );
    expect(resp.status).toBe(403);
  });

  it("blocks private IP host (SSRF protection)", async () => {
    const { GET } = await import("@/app/api/proxy/tile/route");
    const resp = await GET(mockRequest("/api/proxy/tile?url=https://192.168.1.1/{z}/{x}/{y}.png&z=0&x=0&y=0"));
    expect(resp.status).toBe(403);
  });
});
