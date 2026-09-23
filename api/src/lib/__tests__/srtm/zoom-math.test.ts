import { describe, it, expect } from "vitest";
import {
  tileToLatLon,
  latLonToTile,
  pixelToLatLon,
  srtmPixelsPerTilePixel,
  getResampleMode,
} from "../../srtm/zoom-math";

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
    const { x } = latLonToTile(0, 179.9, 2);
    expect(x).toBe(3);
  });
});

describe("pixelToLatLon", () => {
  it("inverts latLonToTile at pixel granularity", () => {
    for (const [lat, lon, z] of [
      [40.7, -74.0, 10],
      [0, 0, 5],
      [28, 86, 10],
      [-33.9, 151.2, 8],
      [64.1, -21.9, 12],
    ]) {
      const { x, y } = latLonToTile(lat, lon, z);
      // Center pixel of the containing tile's sub-cell: tile index * 256
      // plus the fractional position, +0.5 for the pixel center.
      const fx = ((lon + 180) / 360) * Math.pow(2, z) * 256;
      const latRad = (lat * Math.PI) / 180;
      const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z) * 256;
      const { lat: outLat, lon: outLon } = pixelToLatLon(z, x * 256 + (fx % 256), y * 256 + (fy % 256));
      expect(outLat).toBeCloseTo(lat, 6);
      expect(outLon).toBeCloseTo(lon, 6);
    }
  });

  it("world corners map to the expected bounds", () => {
    const world = Math.pow(2, 10) * 256;
    const topLeft = pixelToLatLon(10, 0, 0);
    expect(topLeft.lon).toBe(-180);
    expect(topLeft.lat).toBeCloseTo(85.05, 1);
    const bottomRight = pixelToLatLon(10, world, world);
    expect(bottomRight.lon).toBe(180);
    expect(bottomRight.lat).toBeCloseTo(-85.05, 1);
  });

  it("matches tileToLatLon edges", () => {
    const z = 9;
    const x = 150;
    const y = 190;
    const b = tileToLatLon(z, x, y);
    const nw = pixelToLatLon(z, x * 256, y * 256);
    const se = pixelToLatLon(z, (x + 1) * 256, (y + 1) * 256);
    expect(nw.lon).toBeCloseTo(b.west, 9);
    expect(nw.lat).toBeCloseTo(b.north, 9);
    expect(se.lon).toBeCloseTo(b.east, 9);
    expect(se.lat).toBeCloseTo(b.south, 9);
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
