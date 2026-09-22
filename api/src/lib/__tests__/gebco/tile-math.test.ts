import { describe, it, expect } from "vitest";
import { latLonToQuadName, quadNameToBounds, latLonToPixel } from "../../gebco/tile-math";

describe("latLonToQuadName", () => {
  it("northern hemisphere / western longitudes", () => {
    expect(latLonToQuadName(40, -74)).toBe("gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif");
  });

  it("southern hemisphere / eastern longitudes", () => {
    expect(latLonToQuadName(-40, 20)).toBe("gebco_2025_n0.0_s-90.0_w0.0_e90.0.tif");
  });

  it("equator is northern band, prime meridian is w0_e90 band", () => {
    expect(latLonToQuadName(0, 0)).toBe("gebco_2025_n90.0_s0.0_w0.0_e90.0.tif");
  });

  it("longitude band boundaries are left-inclusive", () => {
    expect(latLonToQuadName(10, -90)).toBe("gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif");
    expect(latLonToQuadName(10, -90.1)).toBe("gebco_2025_n90.0_s0.0_w-180.0_e-90.0.tif");
    expect(latLonToQuadName(10, 0)).toBe("gebco_2025_n90.0_s0.0_w0.0_e90.0.tif");
    expect(latLonToQuadName(10, -0.1)).toBe("gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif");
    expect(latLonToQuadName(10, 90)).toBe("gebco_2025_n90.0_s0.0_w90.0_e180.0.tif");
    expect(latLonToQuadName(10, 89.9)).toBe("gebco_2025_n90.0_s0.0_w0.0_e90.0.tif");
  });

  it("latitude band boundary is inclusive of zero", () => {
    expect(latLonToQuadName(0, 120)).toBe("gebco_2025_n90.0_s0.0_w90.0_e180.0.tif");
    expect(latLonToQuadName(-0.1, 120)).toBe("gebco_2025_n0.0_s-90.0_w90.0_e180.0.tif");
  });
});

describe("quadNameToBounds", () => {
  it("parses a northern/western quadrant", () => {
    expect(quadNameToBounds("gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif")).toEqual({
      latMax: 90,
      latMin: 0,
      lonMin: -90,
      lonMax: 0,
    });
  });

  it("parses a southern/eastern quadrant", () => {
    expect(quadNameToBounds("gebco_2025_n0.0_s-90.0_w0.0_e90.0.tif")).toEqual({
      latMax: 0,
      latMin: -90,
      lonMin: 0,
      lonMax: 90,
    });
  });

  it("round-trips every quadrant produced by latLonToQuadName", () => {
    for (const [lat, lon] of [
      [40, -74],
      [-40, 20],
      [0, 0],
      [10, -120],
      [-10, 120],
    ]) {
      const bounds = quadNameToBounds(latLonToQuadName(lat, lon));
      expect(bounds).not.toBeNull();
      expect(bounds?.latMin).toBeLessThan(bounds?.latMax ?? 0);
      expect(bounds?.lonMin).toBeLessThan(bounds?.lonMax ?? 0);
    }
  });

  it("returns null for a name that is not a GEBCO quadrant", () => {
    expect(quadNameToBounds("N41W074.tif")).toBeNull();
    expect(quadNameToBounds("gebco_2024_n90.0_s0.0_w-90.0_e0.0.tif")).toBeNull();
    expect(quadNameToBounds("")).toBeNull();
  });
});

describe("latLonToPixel", () => {
  const nw = quadNameToBounds("gebco_2025_n90.0_s0.0_w-90.0_e0.0.tif");
  const se = quadNameToBounds("gebco_2025_n0.0_s-90.0_w0.0_e90.0.tif");

  it("throws no surprise for missing bounds input", () => {
    // 240 pixels per degree, origin at the NW corner of the quadrant
    expect(nw).not.toBeNull();
    expect(se).not.toBeNull();
  });

  it("maps a mid-quadrant point to row/col", () => {
    // (90 - 40) * 240 = 12000, (-74 - (-90)) * 240 = 3840
    expect(latLonToPixel(40, -74, nw as NonNullable<typeof nw>)).toEqual({ row: 12000, col: 3840 });
  });

  it("maps the NW corner of the quadrant to pixel 0,0", () => {
    expect(latLonToPixel(90, -90, nw as NonNullable<typeof nw>)).toEqual({ row: 0, col: 0 });
  });

  it("maps a southern/eastern quadrant point", () => {
    // (0 - (-40)) * 240 = 9600, (20 - 0) * 240 = 4800
    expect(latLonToPixel(-40, 20, se as NonNullable<typeof se>)).toEqual({ row: 9600, col: 4800 });
  });

  it("rounds to the nearest pixel", () => {
    // (90 - 89.998) * 240 = 0.48 -> 0
    expect(latLonToPixel(89.998, -90, nw as NonNullable<typeof nw>).row).toBe(0);
    // (90 - 89.9979) * 240 = 0.504 -> 1
    expect(latLonToPixel(89.9979, -90, nw as NonNullable<typeof nw>).row).toBe(1);
  });

  it("clamps past the south/east edge of the quadrant", () => {
    // lat 0 in the northern quadrant -> row (90-0)*240 = 21600 -> clamped to 21599
    const p = latLonToPixel(0, 0, nw as NonNullable<typeof nw>);
    expect(p.row).toBe(21599);
    expect(p.col).toBe(21599);
  });

  it("clamps negative row/col to 0", () => {
    const p = latLonToPixel(95, -95, nw as NonNullable<typeof nw>);
    expect(p.row).toBe(0);
    expect(p.col).toBe(0);
  });

  it("uses the full 21600 pixel extent at 15 arc-seconds", () => {
    // 90 degrees * 240 pixels/degree = 21600 rows per quadrant
    expect(Math.round((90 - 0) * 240)).toBe(21600);
  });
});
