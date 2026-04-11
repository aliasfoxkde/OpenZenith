import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockRequest } from "./helpers";

const mockBgpResponse = { prefix: "8.8.8.0/24", as_path: ["15169"], origin: "igp" };

describe("BGP endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 when prefix is missing", async () => {
    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("prefix");
  });

  it("returns BGP data for known prefix", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(mockBgpResponse), { status: 200 }));

    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp?prefix=8.8.8.0/24");
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    const data = await resp.json();
    expect(data.prefix).toBe("8.8.8.0/24");
    expect(data.data).toBeDefined();
  });

  it("includes CORS and cache headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(mockBgpResponse), { status: 200 }));

    const { GET } = await import("@/app/api/bgp/route");
    const req = mockRequest("/api/bgp?prefix=8.8.8.0/24");
    const resp = await GET(req);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toContain("public");
  });
});
