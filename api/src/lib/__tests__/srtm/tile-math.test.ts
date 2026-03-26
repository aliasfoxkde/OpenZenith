import { describe, it, expect } from "vitest";
import {
  latLonToSrtmName,
  srtmNameToBounds,
  latLonToPixel,
  isWithinSRTM,
  SRTM_BOUNDS,
} from "../../srtm/tile-math";

describe("latLonToSrtmName", () => {
  it("north-east tile", () => {
    expect(latLonToSrtmName(28.5, 86.5)).toBe("N28E086.tif");
  });

  it("south-west tile", () => {
    expect(latLonToSrtmName(-23.5, -43.5)).toBe("S23W043.tif");
  });

  it("equator and prime meridian", () => {
    expect(latLonToSrtmName(0, 0)).toBe("N00E000.tif");
  });

  it("negative zero lat", () => {
    expect(latLonToSrtmName(-0.1, 0)).toBe("S00E000.tif");
  });

  it("high latitudes with 3-digit lon", () => {
    expect(latLonToSrtmName(40, -105.5)).toBe("N40W105.tif");
  });

  it("pads lat and lon correctly", () => {
    expect(latLonToSrtmName(5, 8)).toBe("N05E008.tif");
  });
});

describe("srtmNameToBounds", () => {
  it("N28E086", () => {
    const b = srtmNameToBounds("N28E086.tif");
    expect(b).toEqual({ latMin: 28, lonMin: 86, latMax: 29, lonMax: 87 });
  });

  it("S23W043", () => {
    const b = srtmNameToBounds("S23W043.tif");
    expect(b).toEqual({ latMin: -24, lonMin: -44, latMax: -23, lonMax: -43 });
  });

  it("N00E000 at equator", () => {
    const b = srtmNameToBounds("N00E000.tif");
    expect(b).toEqual({ latMin: 0, lonMin: 0, latMax: 1, lonMax: 1 });
  });

  it("S01W180 at date line", () => {
    const b = srtmNameToBounds("S01W180.tif");
    expect(b).toEqual({ latMin: -2, lonMin: -181, latMax: -1, lonMax: -180 });
  });
});

describe("latLonToPixel", () => {
  const bounds = { latMin: 28, lonMin: 86, latMax: 29, lonMax: 87 };

  it("top-left corner (max lat, min lon)", () => {
    const p = latLonToPixel(29, 86, bounds);
    expect(p).toEqual({ row: 0, col: 0 });
  });

  it("bottom-right corner (min lat, max lon)", () => {
    const p = latLonToPixel(28, 87, bounds);
    expect(p).toEqual({ row: 3600, col: 3600 });
  });

  it("center of tile", () => {
    const p = latLonToPixel(28.5, 86.5, bounds);
    expect(p.row).toBe(1800);
    expect(p.col).toBe(1800);
  });

  it("clamps out-of-bounds lat", () => {
    const p = latLonToPixel(30, 86.5, bounds);
    expect(p.row).toBe(0);
  });

  it("clamps out-of-bounds lon", () => {
    const p = latLonToPixel(28.5, 85, bounds);
    expect(p.col).toBe(0);
  });
});

describe("isWithinSRTM", () => {
  it("returns true for point inside coverage", () => {
    expect(isWithinSRTM(40, -100)).toBe(true);
  });

  it("returns true for point at coverage edge", () => {
    expect(isWithinSRTM(60, 180)).toBe(true);
  });

  it("returns false for point above coverage", () => {
    expect(isWithinSRTM(65, 0)).toBe(false);
  });

  it("returns false for point below coverage", () => {
    expect(isWithinSRTM(-65, 0)).toBe(false);
  });

  it("returns true for SRTM_BOUNDS values", () => {
    expect(isWithinSRTM(SRTM_BOUNDS.latMin, SRTM_BOUNDS.lonMin)).toBe(true);
    expect(isWithinSRTM(SRTM_BOUNDS.latMax, SRTM_BOUNDS.lonMax)).toBe(true);
  });
});
