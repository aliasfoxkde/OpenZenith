import { describe, it, expect } from "vitest";
import {
  haversineDistance,
  pathDistance,
  sphericalPolygonArea,
  formatDistance,
  formatArea,
  bearing,
} from "@/app/map/lib/measure";

describe("haversineDistance", () => {
  it("returns 0 for same point", () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
  });

  it("computes distance from equator to north pole", () => {
    const d = haversineDistance(0, 0, 90, 0);
    // Quarter circumference of Earth ≈ 10,008 km
    expect(d).toBeGreaterThan(9_900_000);
    expect(d).toBeLessThan(10_200_000);
  });

  it("computes distance between NYC and London", () => {
    const d = haversineDistance(40.7128, -74.006, 51.5074, -0.1278);
    // ~5,570 km
    expect(d).toBeGreaterThan(5_000_000);
    expect(d).toBeLessThan(6_000_000);
  });

  it("handles southern hemisphere", () => {
    const d = haversineDistance(-33.8688, 151.2093, -37.8136, 144.9631);
    // Sydney to Melbourne ≈ 713 km
    expect(d).toBeGreaterThan(600_000);
    expect(d).toBeLessThan(800_000);
  });
});

describe("pathDistance", () => {
  it("returns 0 for single point", () => {
    expect(pathDistance([[0, 0]])).toBe(0);
  });

  it("returns 0 for empty array", () => {
    expect(pathDistance([])).toBe(0);
  });

  it("sums distances along a path", () => {
    // Three points in a straight line along equator
    const coords: [number, number][] = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    const d = pathDistance(coords);
    // ~111 km per degree at equator
    expect(d).toBeGreaterThan(200_000);
    expect(d).toBeLessThan(250_000);
  });
});

describe("sphericalPolygonArea", () => {
  it("returns 0 for less than 3 points", () => {
    expect(sphericalPolygonArea([])).toBe(0);
    expect(sphericalPolygonArea([[0, 0]])).toBe(0);
    expect(
      sphericalPolygonArea([
        [0, 0],
        [1, 0],
      ]),
    ).toBe(0);
  });

  it("computes area for a small triangle", () => {
    // 1 degree triangle near equator
    const coords: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 0],
    ];
    const area = sphericalPolygonArea(coords);
    // ~12,100 km² for 1°x1° at equator
    expect(area).toBeGreaterThan(5_000_000_000);
    expect(area).toBeLessThan(20_000_000_000);
  });
});

describe("formatDistance", () => {
  it("formats meters for small distances", () => {
    expect(formatDistance(500)).toBe("500.0 m");
  });

  it("formats km for medium distances", () => {
    expect(formatDistance(5000)).toBe("5.00 km");
  });

  it("formats km with two decimals for large distances", () => {
    expect(formatDistance(150000)).toBe("150.00 km");
  });
});

describe("formatArea", () => {
  it("formats m² for small areas", () => {
    expect(formatArea(5000)).toBe("5000.0 m²");
  });

  it("formats hectares for medium areas", () => {
    expect(formatArea(50000)).toBe("5.00 ha");
  });

  it("formats km² for large areas", () => {
    expect(formatArea(5_000_000)).toBe("5.00 km²");
  });
});

describe("bearing", () => {
  it("returns 0 for north", () => {
    expect(bearing(0, 0, 1, 0)).toBe(0);
  });

  it("returns ~90 for east", () => {
    const b = bearing(0, 0, 0, 1);
    expect(b).toBeGreaterThan(85);
    expect(b).toBeLessThan(95);
  });

  it("returns ~180 for south", () => {
    const b = bearing(0, 0, -1, 0);
    expect(b).toBeGreaterThan(175);
    expect(b).toBeLessThan(185);
  });
});
