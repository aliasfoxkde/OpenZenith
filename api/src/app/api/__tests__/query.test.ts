import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/elevation/terrarium-reader", () => ({
  getElevationFromR2: vi.fn().mockResolvedValue({ elevation: 100, source: "huggingface", resolution: 30, unit: "meters", location: { lat: 40.7, lon: -74.0 } }),
}));
vi.mock("@/lib/weather/open-meteo", () => ({
  getWeather: vi.fn().mockResolvedValue({ current: { temperature: 15, apparentTemperature: 13 }, daily: [], units: { temperature: "°C" } }),
}));
vi.mock("@/lib/tides/noaa", () => ({
  getTides: vi.fn().mockResolvedValue(null),
}));

describe("Query API", () => {
  it("requires lat and lon", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(new Request("http://localhost/api/query"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Missing");
  });

  it("rejects invalid coordinates", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(new Request("http://localhost/api/query?lat=999&lon=0"));
    expect(resp.status).toBe(400);
  });

  it("returns elevation by default", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(new Request("http://localhost/api/query?lat=40.7&lon=-74.0"));
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.location).toEqual({ lat: 40.7, lon: -74.0 });
    expect(data.elevation).toBeTruthy();
    expect(data.elevation.elevation).toBe(100);
  });

  it("rejects invalid include values", async () => {
    const { GET } = await import("@/app/api/query/route");
    const resp = await GET(new Request("http://localhost/api/query?lat=40.7&lon=-74.0&include=invalid_type"));
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain("Invalid include");
  });
});
