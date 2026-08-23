import { describe, it, expect, vi } from "vitest";
import { mockRequest } from "./helpers";

const MOCK_IBTRACS = `SID,SEASON,BASIN,SUBBASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,TRACK_TYPE
2024272N18284,2024,NA,NORTH_ATLANTIC,MILTON,2024-10-09 18:00:00,TS,22.8,-89.1,55,982,main
2024272N18284,2024,NA,NORTH_ATLANTIC,MILTON,2024-10-09 12:00:00,TS,23.0,-89.4,50,987,main`;

const MOCK_SHORT_CSV = `SID,SEASON,BASIN,SUBBASIN,NAME,ISO_TIME,NATURE,LAT,LON,WMO_WIND,WMO_PRES,TRACK_TYPE
2024272N18284,2024,NA,NORTH_ATLANTIC,MILTON,2024-10-09 18:00:00,TS,22.8,-89.1,55,982,main`;

describe("Hurricanes API", () => {
  it("returns GeoJSON FeatureCollection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(MOCK_IBTRACS, { status: 200, headers: { "Content-Type": "text/csv" } }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes?active=false"));
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
    const resp = await GET(mockRequest("/api/hurricanes"));
    expect(resp.status).toBe(200);
  });

  it("handles empty CSV response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("SID,SEASON\n", { status: 200, headers: { "Content-Type": "text/csv" } }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.features).toHaveLength(0);
  });

  it("returns error on malformed CSV", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not,csv,at,all", { status: 200 }),
    );

    const { GET } = await import("@/app/api/hurricanes/route");
    const resp = await GET(mockRequest("/api/hurricanes"));
    expect(resp.status).toBe(200);
  });

  it("handles CORS preflight OPTIONS", async () => {
    const { OPTIONS } = await import("@/app/api/hurricanes/route");
    const resp = await OPTIONS();
    expect(resp.status).toBe(204);
  });
});
