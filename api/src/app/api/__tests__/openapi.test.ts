import { describe, it, expect } from "vitest";

describe("OpenAPI spec endpoint", () => {
  it("returns valid OpenAPI 3.0.3 spec", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = await GET();
    expect(resp.status).toBe(200);

    const spec = await resp.json();
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("OpenZenith API");
    expect(spec.info.version).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(spec.servers).toBeDefined();
    expect(spec.tags).toBeDefined();
  });

  it("includes all expected endpoints", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = await GET();
    const spec = await resp.json();

    const expectedPaths = ["/api/elevation", "/api/health", "/api/geoip", "/api/nlnog", "/api/bgp"];

    for (const path of expectedPaths) {
      expect(spec.paths[path]).toBeDefined();
    }
  });

  it("includes CORS headers", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = await GET();
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });
});
