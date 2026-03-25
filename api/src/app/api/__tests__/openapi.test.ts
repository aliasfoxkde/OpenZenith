import { describe, it, expect } from "vitest";

describe("OpenAPI spec endpoint", () => {
  it("returns valid OpenAPI 3.0.3 spec", async () => {
    const res = await fetch("http://localhost:9006/api/openapi.json");
    expect(res.status).toBe(200);

    const spec = await res.json();
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("OpenZenith API");
    expect(spec.info.version).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(spec.servers).toBeDefined();
    expect(spec.tags).toBeDefined();
  });

  it("includes all expected endpoints", async () => {
    const res = await fetch("http://localhost:9006/api/openapi.json");
    const spec = await res.json();

    const expectedPaths = [
      "/api/elevation",
      "/api/health",
      "/api/geoip",
      "/api/nlnog",
      "/api/bgp",
    ];

    for (const path of expectedPaths) {
      expect(spec.paths[path]).toBeDefined();
    }
  });

  it("includes CORS headers", async () => {
    const res = await fetch("http://localhost:9006/api/openapi.json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
