import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";
import pkg from "../../../../package.json";

describe("OpenAPI spec endpoint", () => {
  it("returns valid OpenAPI 3.0.3 spec", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = GET(mockRequest("/api/openapi.json"));
    expect(resp.status).toBe(200);

    const spec = await resp.json();
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("OpenZenith API");
    expect(spec.info.version).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(spec.servers).toBeDefined();
    expect(spec.tags).toBeDefined();
  });

  it("reports the released version, not a stale literal", async () => {
    // The spec version rotted at 0.7.0 through the whole 0.8.x line; this
    // pins it to package.json so a bump without a regen fails here.
    const { GET } = await import("@/app/api/openapi.json/route");
    const spec = await GET(mockRequest("/api/openapi.json")).json();
    expect(spec.info.version).toBe(pkg.version);
  });

  it("includes all expected endpoints", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = GET(mockRequest("/api/openapi.json"));
    const spec = await resp.json();

    const expectedPaths = ["/api/elevation", "/api/health", "/api/geoip", "/api/nlnog", "/api/bgp"];

    for (const path of expectedPaths) {
      expect(spec.paths[path]).toBeDefined();
    }
  });

  it("includes CORS headers", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = GET(mockRequest("/api/openapi.json"));
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });
});
