import { describe, it, expect } from "vitest";

describe("Elevation endpoint", () => {
  it("returns 400 when lat is missing", async () => {
    const res = await fetch("http://localhost:9006/api/elevation?lon=86.9");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("lat");
  });

  it("returns 400 when lon is missing", async () => {
    const res = await fetch("http://localhost:9006/api/elevation?lat=28.0");
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("lon");
  });

  it("returns 400 when lat is not a number", async () => {
    const res = await fetch("http://localhost:9006/api/elevation?lat=abc&lon=86.9");
    expect(res.status).toBe(400);
  });

  it("returns elevation data for Mount Everest", async () => {
    const res = await fetch("http://localhost:9006/api/elevation?lat=28.0&lon=86.9");
    expect(res.status).toBe(200);

    const data = await res.json();
    // SRTM 30m can under-report at sharp peaks; Everest summit is ~8849m but
    // the nearest 30m cell may be significantly lower
    expect(data.elevation).toBeGreaterThan(6000);
    expect(data.unit).toBe("meters");
    expect(data.source).toBe("srtm30m");
    expect(data.srtmTile).toContain("N28E086");
    expect(data.resolution).toBe(30);
    expect(data.location).toEqual({ lat: 28.0, lon: 86.9 });
  });

  it("returns elevation data for sea-level location", async () => {
    const res = await fetch("http://localhost:9006/api/elevation?lat=0&lon=0");
    expect(res.status).toBe(200);

    const data = await res.json();
    // Gulf of Guinea — should be near 0m (may be null if no data)
    if (data.elevation !== null) {
      expect(data.elevation).toBeLessThan(100);
      expect(data.elevation).toBeGreaterThanOrEqual(-500);
    } else {
      expect(data.elevation).toBeNull();
    }
  });

  it("includes CORS and cache headers", async () => {
    const res = await fetch("http://localhost:9006/api/elevation?lat=28.0&lon=86.9");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("public");
  });
});
