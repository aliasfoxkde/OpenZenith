import { describe, expect, it } from "vitest";
import { classifyOrbit, orbitalVelocityKms } from "../orbit";

describe("classifyOrbit", () => {
  it("labels low orbits LEO below 2000 km", () => {
    expect(classifyOrbit(0)).toBe("LEO");
    expect(classifyOrbit(420)).toBe("LEO");
    expect(classifyOrbit(1999)).toBe("LEO");
  });

  it("labels the middle regime MEO", () => {
    expect(classifyOrbit(2000)).toBe("MEO");
    expect(classifyOrbit(20200)).toBe("MEO"); // GNSS territory
    expect(classifyOrbit(30000)).toBe("MEO");
  });

  it("labels synchronous orbits GEO above 30000 km", () => {
    expect(classifyOrbit(35786)).toBe("GEO");
  });
});

describe("orbitalVelocityKms", () => {
  it("pins GEO at the synchronous rate", () => {
    expect(orbitalVelocityKms(35786)).toBe(3.07);
  });

  it("follows the app's circular-velocity approximation for LEO", () => {
    // Extracted behavior: 7.66 / sqrt(1 + 420/6371) ≈ 7.42 km/s at ISS altitude.
    expect(orbitalVelocityKms(420)).toBeCloseTo(7.42, 1);
  });

  it("decreases with altitude below GEO", () => {
    expect(orbitalVelocityKms(2000)).toBeLessThan(orbitalVelocityKms(400));
  });
});
