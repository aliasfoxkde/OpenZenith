import { describe, it, expect } from "vitest";
import { latLonToSrtmName, srtmNameToBounds, latLonToPixel, isWithinSRTM, SRTM_BOUNDS } from "../../srtm/tile-math";

describe("latLonToSrtmName", () => {
  it("north-east tile", () => {
    expect(latLonToSrtmName(28.5, 86.5)).toBe("N28E086.tif");
  });

  it("south-west tile", () => {
    expect(latLonToSrtmName(-23.5, -43.5)).toBe("S24W044.tif");
  });

  it("equator and prime meridian", () => {
    expect(latLonToSrtmName(0, 0)).toBe("N00E000.tif");
  });

  it("lat just south of the equator lands in S01 (cell [-1, 0])", () => {
    expect(latLonToSrtmName(-0.1, 0)).toBe("S01E000.tif");
  });

  it("high latitudes with 3-digit lon", () => {
    expect(latLonToSrtmName(40, -105.5)).toBe("N40W106.tif");
  });

  it("pads lat and lon correctly", () => {
    expect(latLonToSrtmName(5, 8)).toBe("N05E008.tif");
  });

  // Data-anchored regressions (2026-10-05 prod defect): truncating the
  // absolute value selected the cell one degree east/south, so every
  // western/southern query read the wrong .merged file. Names below are
  // verified against the local dataset — N19W156.merged holds Mauna Kea.
  it("Mauna Kea lands in N19W156 (the cell holding its summit)", () => {
    expect(latLonToSrtmName(19.8206, -155.4681)).toBe("N19W156.tif");
  });

  it("NYC lands in N40W075 (cell [-75, -74])", () => {
    expect(latLonToSrtmName(40.7128, -74.006)).toBe("N40W075.tif");
  });

  it("Rio de Janeiro lands in S23W044 (real SRTM tile name)", () => {
    expect(latLonToSrtmName(-22.9111, -43.2265)).toBe("S23W044.tif");
  });
});

describe("srtmNameToBounds", () => {
  it("N28E086", () => {
    const b = srtmNameToBounds("N28E086.tif");
    expect(b).toEqual({ latMin: 28, lonMin: 86, latMax: 29, lonMax: 87 });
  });

  it("S24W044 (SW-corner naming)", () => {
    const b = srtmNameToBounds("S24W044.tif");
    expect(b).toEqual({ latMin: -24, lonMin: -44, latMax: -23, lonMax: -43 });
  });

  it("N00E000 at equator", () => {
    const b = srtmNameToBounds("N00E000.tif");
    expect(b).toEqual({ latMin: 0, lonMin: 0, latMax: 1, lonMax: 1 });
  });

  it("S01W180 at date line", () => {
    const b = srtmNameToBounds("S01W180.tif");
    expect(b).toEqual({ latMin: -1, lonMin: -180, latMax: 0, lonMax: -179 });
  });

  it("N19W156 — data-verified: this cell contains Mauna Kea", () => {
    const b = srtmNameToBounds("N19W156.tif");
    expect(b).toEqual({ latMin: 19, lonMin: -156, latMax: 20, lonMax: -155 });
  });
});

describe("latLonToSrtmName/srtmNameBounds inverse property", () => {
  // For every point, the parsed bounds of its cell name must contain the
  // point — this is what broke in production (western/southern points
  // were named into the neighbouring cell).
  const points: Array<[number, number]> = [
    [19.8206, -155.4681],
    [43.0886, -71.8294],
    [40.7128, -74.006],
    [-22.9111, -43.2265],
    [-33.8688, 151.2093],
    [27.9879, 86.925],
    [0.5, 0.5],
    [-0.5, 0.5],
    [0.5, -0.5],
    [-0.5, -0.5],
    [59.9333, 30.3333],
    [-54.8019, -68.303],
    [59.5, -179.5],
    [-0.0001, 179.9999],
  ];

  it.each(points)("bounds of %f, %f contain the point", (lat, lon) => {
    const b = srtmNameToBounds(latLonToSrtmName(lat, lon));
    expect(b.latMin).toBeLessThanOrEqual(lat);
    expect(lat).toBeLessThan(b.latMax);
    expect(b.lonMin).toBeLessThanOrEqual(lon);
    expect(lon).toBeLessThan(b.lonMax);
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
