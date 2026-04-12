import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

describe("Proxy WMS API", () => {
  it("proxies WMS GetMap request from allowed host", async () => {
    const mockPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(mockPng, { status: 200, headers: { "Content-Type": "image/png" } }),
    );

    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms?url=https://example.com/wms&layers=test&BBOX=-180,-90,180,90"));
    expect(resp.status).toBe(200);
  });

  it("returns error when url is missing", async () => {
    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(mockRequest("/api/proxy/wms"));
    expect(resp.status).toBe(400);
  });

  it("blocks disallowed host (SSRF protection)", async () => {
    const { GET } = await import("@/app/api/proxy/wms/route");
    const resp = await GET(
      mockRequest("/api/proxy/wms?url=https://internal-server.local/wms&layers=test&BBOX=-180,-90,180,90"),
    );
    expect(resp.status).toBe(403);
  });
});
