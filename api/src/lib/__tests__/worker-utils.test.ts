import { describe, it, expect } from "vitest";
import { haversineMeters, interpolateCoords } from "../worker-utils";

describe("haversineMeters", () => {
  it("returns 0 for same point", () => {
    expect(haversineMeters(0, 0, 0, 0)).toBe(0);
  });

  it("computes distance for known points", () => {
    // Distance from equator to 1 degree north at same longitude
    const d = haversineMeters(0, 0, 1, 0);
    // 1 degree of latitude ≈ 111,195 meters
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  it("is symmetric", () => {
    const d1 = haversineMeters(40.7128, -74.006, 34.0522, -118.2437);
    const d2 = haversineMeters(34.0522, -118.2437, 40.7128, -74.006);
    expect(d1).toBeCloseTo(d2, 0);
  });

  it("computes NYC to LA distance approximately", () => {
    const d = haversineMeters(40.7128, -74.006, 34.0522, -118.2437);
    // NYC to LA is approximately 3,944 km
    expect(d).toBeGreaterThan(3900000);
    expect(d).toBeLessThan(4000000);
  });
});

describe("interpolateCoords", () => {
  it("returns start and end for numSamples=0 (clamped to 1)", () => {
    const result = interpolateCoords([0, 0], [10, 10], 0);
    // numSamples=0 is clamped to 1, so loop runs i <= 1
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0, 0]);
    expect(result[1]).toEqual([10, 10]);
  });

  it("returns correct number of points", () => {
    const result = interpolateCoords([0, 0], [10, 10], 10);
    expect(result).toHaveLength(11); // 0 to 10 inclusive
  });

  it("starts at start coordinate", () => {
    const result = interpolateCoords([5, 10], [15, 20], 5);
    expect(result[0]).toEqual([5, 10]);
  });

  it("ends at end coordinate", () => {
    const result = interpolateCoords([5, 10], [15, 20], 5);
    expect(result[result.length - 1]).toEqual([15, 20]);
  });

  it("interpolates linearly", () => {
    const result = interpolateCoords([0, 0], [10, 0], 10);
    // Should have evenly spaced longitude values
    for (let i = 0; i <= 10; i++) {
      expect(result[i][0]).toBeCloseTo(i, 5);
      expect(result[i][1]).toBeCloseTo(0, 5);
    }
  });
});
