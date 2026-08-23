/**
 * Unit tests for lib/format-units.ts
 */

import { describe, it, expect } from "vitest";
import { formatDistance, formatArea } from "../format-units";

describe("formatDistance", () => {
  it("formats meters below 1000", () => {
    expect(formatDistance(500)).toBe("500.0 m");
    expect(formatDistance(0)).toBe("0.0 m");
    expect(formatDistance(999.9)).toBe("999.9 m");
  });

  it("formats kilometers for 1000+ meters", () => {
    expect(formatDistance(1000)).toBe("1.00 km");
    expect(formatDistance(1500)).toBe("1.50 km");
    expect(formatDistance(10000)).toBe("10.00 km");
  });

  it("formats feet for imperial below 5280", () => {
    expect(formatDistance(100, true)).toBe("328.1 ft");
    expect(formatDistance(0, true)).toBe("0.0 ft");
  });

  it("formats miles for imperial 5280+ feet", () => {
    // 1609.35 m = 5280.03 ft → 1.00 mi
    expect(formatDistance(1609.35, true)).toBe("1.00 mi");
    // 10000 m = 32808 ft = 6.21 mi
    expect(formatDistance(10000, true)).toBe("6.21 mi");
  });
});

describe("formatArea", () => {
  it("formats square meters below 10,000", () => {
    expect(formatArea(500)).toBe("500.0 m²");
    expect(formatArea(9999)).toBe("9999.0 m²");
  });

  it("formats hectares for 10,000+ sqm", () => {
    expect(formatArea(10000)).toBe("1.00 ha");
    expect(formatArea(50000)).toBe("5.00 ha");
  });

  it("formats sq km for 1,000,000+ sqm", () => {
    expect(formatArea(1_000_000)).toBe("1.00 km²");
    expect(formatArea(2_500_000)).toBe("2.50 km²");
  });

  it("formats sq feet for imperial below 43,560", () => {
    // 1000 sqm * 10.7639 = 10763.9 sqft
    expect(formatArea(1000, true)).toBe("10763.9 ft²");
  });

  it("formats acres for imperial 43,560+ sqft", () => {
    expect(formatArea(43560, true)).toBe("10.76 ac");
    // 50000 sqm = 538,195 sqft = 12.36 ac
    expect(formatArea(50000, true)).toBe("12.36 ac");
  });

  it("formats sq miles for large imperial areas", () => {
    // 1 sq mile = 2,589,988 sqm; 1 sq mile in sqft = 27,878,400
    // Need sqm > 2,589,988 to reach sq mi branch
    expect(formatArea(3_000_000, true)).toBe("1.16 mi²");
    expect(formatArea(5_000_000, true)).toBe("1.93 mi²");
  });
});
