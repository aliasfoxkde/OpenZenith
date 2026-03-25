import { describe, it, expect } from "vitest";

const BASE = "http://localhost:9006";

describe("Bathymetry endpoint", () => {
  it("returns surface_type for land coordinates", async () => {
    const res = await fetch(`${BASE}/api/bathymetry?lat=40.7128&lon=-74.0060`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.surface_type).toBe("land");
    expect(data.location).toBeDefined();
    expect(data.location.lat).toBe(40.7128);
    expect(data.location.lon).toBe(-74.006);
    expect(data.unit).toBe("meters");
  });

  it("includes CORS headers", async () => {
    const res = await fetch(`${BASE}/api/bathymetry?lat=0&lon=0`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns ocean surface_type for ocean coordinates", async () => {
    const res = await fetch(`${BASE}/api/bathymetry?lat=0&lon=0`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.surface_type).toBe("ocean");
  });

  it("returns 400 for missing parameters", async () => {
    const res = await fetch(`${BASE}/api/bathymetry?lat=40.7`);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid coordinates", async () => {
    const res = await fetch(`${BASE}/api/bathymetry?lat=999&lon=0`);
    expect(res.status).toBe(400);
  });
});
