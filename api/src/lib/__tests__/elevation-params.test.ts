import { describe, it, expect } from "vitest";
import { convertUnits, parseElevationParams, presentElevation, DEFAULT_ELEVATION_PARAMS } from "../elevation-params";

const parse = (query: string) => parseElevationParams(new URLSearchParams(query));

describe("elevation parameter parsing", () => {
  it("falls back to the behaviour the endpoints had before the params existed", () => {
    expect(parse("")).toEqual({ ok: true, params: DEFAULT_ELEVATION_PARAMS });
    expect(parse("lat=28&lon=86.9")).toEqual({ ok: true, params: DEFAULT_ELEVATION_PARAMS });
  });

  it("accepts each documented value", () => {
    expect(parse("interpolation=nearest")).toEqual({
      ok: true,
      params: { interpolation: "nearest", units: "meters", datum: "egm96" },
    });
    expect(parse("units=feet")).toEqual({
      ok: true,
      params: { interpolation: "bilinear", units: "feet", datum: "egm96" },
    });
    expect(parse("datum=ellipsoid")).toEqual({
      ok: true,
      params: { interpolation: "bilinear", units: "meters", datum: "ellipsoid" },
    });
  });

  it("combines all three", () => {
    expect(parse("interpolation=nearest&units=feet&datum=ellipsoid")).toEqual({
      ok: true,
      params: { interpolation: "nearest", units: "feet", datum: "ellipsoid" },
    });
  });

  it.each([
    ["interpolation=cubic", "interpolation must be 'nearest' or 'bilinear'"],
    ["units=metre", "units must be 'meters' or 'feet'"],
    ["datum=EGM96", "datum must be 'egm96' or 'ellipsoid'"],
    ["datum=", "datum must be 'egm96' or 'ellipsoid'"],
  ])("rejects %s instead of silently ignoring it", (query, message) => {
    expect(parse(query)).toEqual({ ok: false, message });
  });
});

describe("elevation presentation", () => {
  it("leaves the value alone for the default parameters", () => {
    expect(presentElevation(8848.86, -28.755, DEFAULT_ELEVATION_PARAMS)).toBe(8848.9);
    expect(presentElevation(-4100.04, 0, DEFAULT_ELEVATION_PARAMS)).toBe(-4100);
  });

  it("adds the undulation for ellipsoidal heights", () => {
    const ellipsoid = { ...DEFAULT_ELEVATION_PARAMS, datum: "ellipsoid" as const };
    expect(presentElevation(8848.86, -28.755, ellipsoid)).toBe(8820.1);
  });

  it("converts to feet after the datum change", () => {
    const feetEllipsoid = {
      interpolation: "bilinear" as const,
      units: "feet" as const,
      datum: "ellipsoid" as const,
    };
    // 8848.86 - 28.755 = 8820.105 m, rounded to 8820.1 m -> 28,937.4 ft
    expect(presentElevation(8848.86, -28.755, feetEllipsoid)).toBe(28937.4);
    expect(presentElevation(0, 0, { ...DEFAULT_ELEVATION_PARAMS, units: "feet" })).toBe(0);
  });

  it("rounds to 0.1 of the requested unit", () => {
    const feet = { ...DEFAULT_ELEVATION_PARAMS, units: "feet" as const };
    expect(presentElevation(100.004, 0, feet)).toBeCloseTo(328.1, 1);
  });

  it("keeps the raw sample unrounded in convertUnits", () => {
    expect(convertUnits(30.48, "meters")).toBe(30.48);
    expect(convertUnits(30.48, "feet")).toBeCloseTo(100, 6);
  });
});
