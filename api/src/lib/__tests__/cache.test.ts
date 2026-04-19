import { describe, it, expect } from "vitest";
import { CACHE_TTL } from "@/lib/cache";

describe("CACHE_TTL", () => {
  it("has all expected TTL values", () => {
    expect(CACHE_TTL.FLIGHTS).toBe(120);
    expect(CACHE_TTL.MILITARY).toBe(30);
    expect(CACHE_TTL.EARTHQUAKES).toBe(60);
    expect(CACHE_TTL.RADAR).toBe(120);
    expect(CACHE_TTL.WARNINGS).toBe(120);
    expect(CACHE_TTL.VESSELS).toBe(60);
    expect(CACHE_TTL.NLNOG).toBe(3600);
    expect(CACHE_TTL.ELEVATION).toBe(86400);
    expect(CACHE_TTL.BATHYMETRY).toBe(86400);
    expect(CACHE_TTL.WATERWAYS).toBe(3600);
    expect(CACHE_TTL.GEOCODE).toBe(86400);
  });

  it("has logical TTL ordering", () => {
    // Dynamic data should have shorter TTL than static data
    expect(CACHE_TTL.FLIGHTS).toBeLessThanOrEqual(CACHE_TTL.EARTHQUAKES);
    expect(CACHE_TTL.EARTHQUAKES).toBeLessThan(CACHE_TTL.NLNOG);
    expect(CACHE_TTL.NLNOG).toBeLessThan(CACHE_TTL.ELEVATION);
  });
});
