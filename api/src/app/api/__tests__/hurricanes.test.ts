import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/cache", () => ({
  cachedFetch: vi.fn((url: string) => fetch(url)),
  CACHE_TTL: { FLIGHTS: 15, EARTHQUAKES: 60, NLNOG: 3600 },
}));

const MOCK_IBTRACS = `SID,SEASON,BASIN,SUBBASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,TRACK_TYPE
2024272N18284,2024,NA,NORTH_ATLANTIC,MILTON,2024-10-09 18:00:00,TS,22.8,-89.1,55,982,main
2024272N18284,2024,NA,NORTH_ATLANTIC,MILTON,2024-10-09 12:00:00,TS,23.0,-89.4,50,987,main`;

describe("Hurricanes API", () => {
  it("returns GeoJSON FeatureCollection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(MOCK_IBTRACS, { status: 200, headers: { "Content-Type": "text/csv" } }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(new Request("http://localhost/api/hurricanes?active=false"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.type).toBe("FeatureCollection");
    expect(data.features.length).toBeGreaterThan(0);
    expect(data.features[0].properties.name).toBe("MILTON");
    expect(data.features[0].properties.wind).toBe(50);
  });

  it("returns error on upstream failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("error", { status: 500 }));

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(new Request("http://localhost/api/hurricanes"));
    expect(resp.status).toBe(502);
  });
});
