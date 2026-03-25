import { describe, it, expect } from "vitest";

const BASE = "http://localhost:9006";

describe("Geocode endpoint", () => {
  it("returns results for a valid query", async () => {
    const res = await fetch(`${BASE}/api/geocode?query=London&limit=3`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.count).toBeGreaterThan(0);
    expect(data.results[0].lat).toBeDefined();
    expect(data.results[0].lon).toBeDefined();
    expect(data.results[0].display_name).toBeDefined();
  }, 15000);

  it("includes CORS headers", async () => {
    const res = await fetch(`${BASE}/api/geocode?query=Paris`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  }, 15000);

  it("returns empty results for gibberish query", async () => {
    const res = await fetch(`${BASE}/api/geocode?query=xyznonexistent12345`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.results).toHaveLength(0);
    expect(data.count).toBe(0);
  }, 15000);

  it("respects limit parameter", async () => {
    const res = await fetch(`${BASE}/api/geocode?query=Springfield&limit=2`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.results.length).toBeLessThanOrEqual(2);
  }, 15000);
});
