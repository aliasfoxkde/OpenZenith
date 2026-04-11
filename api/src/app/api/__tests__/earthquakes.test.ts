import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/cache", () => ({
  cachedFetch: vi.fn((url: string) => fetch(url)),
  CACHE_TTL: { FLIGHTS: 15, EARTHQUAKES: 60, NLNOG: 3600 },
}));

describe("Earthquakes API", () => {
  it("returns GeoJSON from USGS", async () => {
    const mockGeoJSON = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-122, 37] }, properties: { mag: 3.5 } }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(mockGeoJSON), { status: 200 }));

    const { GET } = await import("@/app/api/earthquakes/route");
    const resp = await GET(new Request("http://localhost/api/earthquakes"));
    const data = await resp.json();

    expect(data.type).toBe("FeatureCollection");
    expect(data.features).toHaveLength(1);
  });

  it("rejects invalid period", async () => {
    const { GET } = await import("@/app/api/earthquakes/route");
    const resp = await GET(new Request("http://localhost/api/earthquakes?period=invalid_period"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Invalid period");
  });

  it("returns error on upstream failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/earthquakes/route");
    const resp = await GET(new Request("http://localhost/api/earthquakes"));
    expect(resp.status).toBe(502);
  });
});
