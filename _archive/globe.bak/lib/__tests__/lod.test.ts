import { describe, it, expect } from "vitest";
import { getZoneForAltitude, getZoneLabel, isEntityVisibleInZone, LOD_ZONES } from "../lod";

describe("LOD_ZONES", () => {
  it("has 4 zones covering all altitudes", () => {
    expect(LOD_ZONES).toHaveLength(4);
    expect(LOD_ZONES[0].name).toBe("earth");
    expect(LOD_ZONES[3].maxAlt).toBe(Infinity);
  });

  it("zones are contiguous (no gaps)", () => {
    for (let i = 1; i < LOD_ZONES.length; i++) {
      expect(LOD_ZONES[i].minAlt).toBe(LOD_ZONES[i - 1].maxAlt);
    }
  });
});

describe("getZoneForAltitude", () => {
  it("returns earth zone at ground level", () => {
    expect(getZoneForAltitude(0).name).toBe("earth");
    expect(getZoneForAltitude(100).name).toBe("earth");
    expect(getZoneForAltitude(499_999).name).toBe("earth");
  });

  it("returns low-orbit zone above 500km", () => {
    expect(getZoneForAltitude(500_000).name).toBe("low-orbit");
    expect(getZoneForAltitude(1_000_000).name).toBe("low-orbit");
    expect(getZoneForAltitude(4_999_999).name).toBe("low-orbit");
  });

  it("returns high-orbit zone above 5Mm", () => {
    expect(getZoneForAltitude(5_000_000).name).toBe("high-orbit");
    expect(getZoneForAltitude(25_000_000).name).toBe("high-orbit");
    expect(getZoneForAltitude(49_999_999).name).toBe("high-orbit");
  });

  it("returns deep-space zone above 50Mm", () => {
    expect(getZoneForAltitude(50_000_000).name).toBe("deep-space");
    expect(getZoneForAltitude(200_000_000).name).toBe("deep-space");
  });
});

describe("getZoneLabel", () => {
  it("returns SURFACE for ground level", () => {
    expect(getZoneLabel(0)).toBe("SURFACE");
  });

  it("returns LOW ORBIT for ISS altitude", () => {
    expect(getZoneLabel(408_000)).toBe("SURFACE"); // ISS at 408km is below 500km threshold
    expect(getZoneLabel(500_000)).toBe("LOW ORBIT");
  });

  it("returns HIGH ORBIT for GEO altitude", () => {
    expect(getZoneLabel(35_786_000)).toBe("HIGH ORBIT");
  });

  it("returns DEEP SPACE for beyond GEO", () => {
    expect(getZoneLabel(100_000_000)).toBe("DEEP SPACE");
  });
});

describe("isEntityVisibleInZone", () => {
  const earthZone = LOD_ZONES[0]; // earth: 0-500km
  const lowOrbitZone = LOD_ZONES[1]; // low-orbit: 500km-5Mm
  const deepSpaceZone = LOD_ZONES[3]; // deep-space: 50Mm+

  it("shows flights in earth zone", () => {
    expect(isEntityVisibleInZone("flight-123", earthZone)).toBe(true);
  });

  it("hides satellites in earth zone", () => {
    expect(isEntityVisibleInZone("sat-123", earthZone)).toBe(false);
  });

  it("shows satellites in low-orbit zone", () => {
    expect(isEntityVisibleInZone("sat-123", lowOrbitZone)).toBe(true);
  });

  it("shows flights in low-orbit zone", () => {
    expect(isEntityVisibleInZone("flight-123", lowOrbitZone)).toBe(true);
  });

  it("hides flights in deep-space zone", () => {
    expect(isEntityVisibleInZone("flight-123", deepSpaceZone)).toBe(false);
  });

  it("shows satellites in deep-space zone", () => {
    expect(isEntityVisibleInZone("sat-123", deepSpaceZone)).toBe(true);
    expect(isEntityVisibleInZone("sat-track-123", deepSpaceZone)).toBe(true);
  });

  it("hides military flights in deep-space zone", () => {
    expect(isEntityVisibleInZone("mil-1", deepSpaceZone)).toBe(false);
  });

  it("shows earthquakes in all zones except deep-space", () => {
    expect(isEntityVisibleInZone("eq-1", earthZone)).toBe(true);
    expect(isEntityVisibleInZone("eq-1", lowOrbitZone)).toBe(true);
    expect(isEntityVisibleInZone("eq-1", LOD_ZONES[2])).toBe(true); // high-orbit
    expect(isEntityVisibleInZone("eq-1", deepSpaceZone)).toBe(false);
  });

  it("returns false for unknown entity types", () => {
    expect(isEntityVisibleInZone("unknown-123", earthZone)).toBe(false);
  });
});
