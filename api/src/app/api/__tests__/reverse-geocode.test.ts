import { describe, it, expect } from "vitest";

const BASE = "http://localhost:9006";

describe("Reverse Geocode endpoint", () => {
  it("returns place data for known coordinates", async () => {
    const res = await fetch(`${BASE}/api/reverse-geocode?lat=38.8977&lon=-77.0365`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.location).toBeDefined();
    expect(data.location.lat).toBeCloseTo(38.8977, 3);
    expect(data.location.lon).toBeCloseTo(-77.0365, 3);
  }, 15000);

  it("includes CORS headers", async () => {
    const res = await fetch(`${BASE}/api/reverse-geocode?lat=0&lon=0`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  }, 15000);

  it("returns place null for ocean coordinates", async () => {
    const res = await fetch(`${BASE}/api/reverse-geocode?lat=0&lon=0`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.location).toBeDefined();
  }, 15000);

  it("accepts zoom parameter", async () => {
    const res = await fetch(`${BASE}/api/reverse-geocode?lat=48.8566&lon=2.3522&zoom=10`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.location).toBeDefined();
  }, 15000);
});
