import { describe, it, expect } from "vitest";
import { tileToLatLon, latLonToTile, srtmPixelsPerTilePixel, getResampleMode } from "../../srtm/zoom-math";

describe("tileToLatLon", () => {
  it("zoom 0 covers the world", () => {
    const b = tileToLatLon(0, 0, 0);
    expect(b.north).toBeCloseTo(85.05, 1);
    expect(b.south).toBeCloseTo(-85.05, 1);
    expect(b.west).toBe(-180);
    expect(b.east).toBe(180);
  });

  it("zoom 10 tile near Denver", () => {
    // Denver is approximately 39.7°N, -105°W
    const { x, y } = latLonToTile(39.7, -105, 10);
    const b = tileToLatLon(10, x, y);
    expect(b.south).toBeLessThanOrEqual(39.7);
    expect(b.north).toBeGreaterThanOrEqual(39.7);
    expect(b.west).toBeLessThanOrEqual(-105);
    expect(b.east).toBeGreaterThanOrEqual(-105);
  });

  it("tile at origin zoom 1", () => {
    const b = tileToLatLon(1, 0, 0);
    expect(b.north).toBeCloseTo(85.05, 1);
    expect(b.west).toBe(-180);
    expect(b.east).toBe(0);
  });
});

describe("latLonToTile", () => {
  it("roundtrip with tileToLatLon", () => {
    for (const [lat, lon, z] of [
      [40, -105, 10],
      [0, 0, 5],
      [28, 86, 10],
      [-33, 151, 8],
    ]) {
      const { x, y } = latLonToTile(lat, lon, z);
      const b = tileToLatLon(z, x, y);
      expect(b.south).toBeLessThanOrEqual(lat);
      expect(b.north).toBeGreaterThanOrEqual(lat);
      expect(b.west).toBeLessThanOrEqual(lon);
      expect(b.east).toBeGreaterThanOrEqual(lon);
    }
  });

  it("equator at zoom 0", () => {
    const { x, y } = latLonToTile(0, 0, 0);
    expect(x).toBe(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(1);
  });

  it("positive longitude at tile boundary", () => {
    const { x, y } = latLonToTile(0, 179.9, 2);
    expect(x).toBe(3);
  });
});

describe("srtmPixelsPerTilePixel", () => {
  it("zoom 0 is very large", () => {
    expect(srtmPixelsPerTilePixel(0)).toBeCloseTo(5062.5, 1);
  });

  it("zoom 10 is near 5 (native)", () => {
    const ratio = srtmPixelsPerTilePixel(10);
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(6);
  });

  it("zoom 15 is very small (sub-pixel)", () => {
    expect(srtmPixelsPerTilePixel(15)).toBeLessThan(1);
  });

  it("halves with each zoom level", () => {
    const z10 = srtmPixelsPerTilePixel(10);
    const z11 = srtmPixelsPerTilePixel(11);
    expect(z11).toBeCloseTo(z10 / 2, 0.01);
  });
});

describe("getResampleMode", () => {
  it("zoom 5 returns downsample", () => {
    expect(getResampleMode(5)).toBe("downsample");
  });

  it("zoom 10 returns downsample", () => {
    expect(getResampleMode(10)).toBe("downsample");
  });

  it("zoom 13 returns native (border case)", () => {
    expect(getResampleMode(13)).toBe("native");
  });

  it("zoom 15 returns interpolate", () => {
    expect(getResampleMode(15)).toBe("interpolate");
  });
});
