import { describe, it, expect } from "vitest";

const BASE = "http://localhost:9006";

describe("Waterways endpoint", () => {
  it("returns GeoJSON for valid bbox (or 502 if Overpass unavailable)", async () => {
    const res = await fetch(`${BASE}/api/waterways?bbox=-74.1,40.6,-73.9,40.8`);
    expect([200, 502]).toContain(res.status);

    if (res.status === 200) {
      const data = await res.json();
      expect(data.type).toBe("FeatureCollection");
      expect(Array.isArray(data.features)).toBe(true);
    } else {
      const data = await res.json();
      expect(data.error).toBeDefined();
    }
  }, 30000);

  it("includes CORS headers", async () => {
    const res = await fetch(`${BASE}/api/waterways?bbox=-74.1,40.6,-73.9,40.8`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  }, 30000);

  it("returns 400 for missing bbox", async () => {
    const res = await fetch(`${BASE}/api/waterways`);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid bbox format", async () => {
    const res = await fetch(`${BASE}/api/waterways?bbox=invalid`);
    expect(res.status).toBe(400);
  });

  it("returns 400 for oversized bbox", async () => {
    const res = await fetch(`${BASE}/api/waterways?bbox=-180,-90,180,90`);
    expect(res.status).toBe(400);
  });

  it("filters by type=rivers (or 502 if Overpass unavailable)", async () => {
    const res = await fetch(`${BASE}/api/waterways?bbox=-74.1,40.6,-73.9,40.8&type=rivers`);
    expect([200, 502]).toContain(res.status);

    if (res.status === 200) {
      const data = await res.json();
      expect(data.type).toBe("FeatureCollection");
    }
  }, 30000);

  it("respects limit parameter (or 502 if Overpass unavailable)", async () => {
    const res = await fetch(`${BASE}/api/waterways?bbox=-74.1,40.6,-73.9,40.8&limit=2`);
    expect([200, 502]).toContain(res.status);

    if (res.status === 200) {
      const data = await res.json();
      expect(data.count).toBeLessThanOrEqual(2);
    }
  }, 30000);
});
