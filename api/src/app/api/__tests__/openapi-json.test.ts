import { describe, it, expect } from "vitest";
import { mockRequest } from "./helpers";

describe("OpenAPI Spec API", () => {
  it("returns valid OpenAPI 3.0 spec", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = GET(mockRequest("/api/openapi.json"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.openapi).toBe("3.0.3");
    expect(data.info.title).toBe("OpenZenith API");
    expect(data.info.version).toBeTruthy();
    expect(data.paths).toBeTruthy();
    expect(Object.keys(data.paths).length).toBeGreaterThan(10);
  });

  it("includes elevation endpoint", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const data = await GET(mockRequest("/api/openapi.json")).json();
    expect(data.paths["/api/elevation"]).toBeTruthy();
    expect(data.paths["/api/elevation"].get).toBeTruthy();
  });

  it("includes health endpoint", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const data = await GET(mockRequest("/api/openapi.json")).json();
    expect(data.paths["/api/health"]).toBeTruthy();
  });

  it("substitutes the deployment origin into the servers entry", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = GET(mockRequest("/api/openapi.json?probe=1"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const data = await resp.json();
    expect(data.servers).toEqual([{ url: "http://localhost:8788", description: "Current deployment" }]);
  });

  it("exposes CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/api/openapi.json/route");
    const resp = OPTIONS();
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(resp.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS");
  });
});
