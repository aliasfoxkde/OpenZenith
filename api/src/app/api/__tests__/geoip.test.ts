import { describe, it, expect } from "vitest";

describe("GeoIP endpoint", () => {
  it("returns location data", async () => {
    const res = await fetch("http://localhost:9006/api/geoip");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(typeof data.ip).toBe("string");
    expect(data.ip).toBeTruthy();
    // Cloudflare edge should always provide these
    expect(data).toHaveProperty("city");
    expect(data).toHaveProperty("country");
    expect(data).toHaveProperty("latitude");
    expect(data).toHaveProperty("longitude");
    expect(data).toHaveProperty("timezone");
  });

  it("includes CORS and cache headers", async () => {
    const res = await fetch("http://localhost:9006/api/geoip");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toContain("public");
  });
});
