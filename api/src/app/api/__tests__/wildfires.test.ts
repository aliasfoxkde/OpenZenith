import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock the cache module
vi.mock("@/lib/cache", () => ({
  cachedFetch: vi.fn((url: string) => fetch(url)),
  CACHE_TTL: { FLIGHTS: 15, EARTHQUAKES: 60, NLNOG: 3600 },
}));

describe("Wildfires API", () => {
  it("returns empty features when no API key is configured", async () => {
    // Import after mock setup
    const { GET } = await import("@/app/api/wildfires/route");
    const resp = await GET();
    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.features).toHaveLength(0);
    expect(data.error).toContain("not configured");
  });
});

describe("Health API", () => {
  it("returns healthy status", async () => {
    const { GET } = await import("@/app/api/health/route");
    const resp = await GET();
    const data = await resp.json();
    expect(data.status).toBe("healthy");
  });
});

describe("OpenAPI spec", () => {
  it("returns a valid OpenAPI document", async () => {
    const { GET } = await import("@/app/api/openapi.json/route");
    const resp = await GET();
    const data = await resp.json();
    expect(data.openapi).toBeTruthy();
    expect(data.paths).toBeTruthy();
    expect(data.info).toBeTruthy();
  });
});
