import { describe, it, expect } from "vitest";

describe("OpenAPI Spec API", () => {
  it("returns valid OpenAPI 3.0 spec", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = await GET();
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
    const data = await (await GET()).json();
    expect(data.paths["/api/elevation"]).toBeTruthy();
    expect(data.paths["/api/elevation"].get).toBeTruthy();
  });

  it("includes health endpoint", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const data = await (await GET()).json();
    expect(data.paths["/api/health"]).toBeTruthy();
  });
});
