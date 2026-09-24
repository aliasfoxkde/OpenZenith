/**
 * Tests for the map URL-hash codec and view-state defaults, extracted from
 * map/page.tsx into lib/view-state.ts so they could be exercised without a
 * MapLibre instance. Node environment: the window-touching helpers take
 * their documented no-window branches.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_STATE,
  buildDefaultLayers,
  buildHash,
  getDefaultBasemap,
  parseHash,
} from "../view-state";

describe("parseHash", () => {
  it("returns an empty partial for an empty hash", () => {
    expect(parseHash("")).toEqual({});
    expect(parseHash("#")).toEqual({});
  });

  it("parses the lng/lat/zoom form with bearing, pitch, and basemap", () => {
    const state = parseHash("#lng=-73.5&lat=40.7&zoom=8.5&b=45&p=60&bm=satellite");
    expect(state.center).toEqual([-73.5, 40.7]);
    expect(state.zoom).toBe(8.5);
    expect(state.bearing).toBe(45);
    expect(state.pitch).toBe(60);
    expect(state.basemap).toBe("satellite");
  });

  it("parses the c=center shorthand", () => {
    const state = parseHash("#c=10.5,-20.25&zoom=4");
    expect(state.center).toEqual([10.5, -20.25]);
    expect(state.zoom).toBe(4);
  });

  it("converts tile x/y/z to a Web Mercator center (z1 tile (1,1) is 0°N 0°E)", () => {
    const state = parseHash("#x=1&y=1&z=1");
    expect(state.center).toEqual([0, 0]);
    expect(state.zoom).toBe(1);
  });

  it("clamps to the Web Mercator latitude bound at the y=0 edge", () => {
    // y=0 at z=0 is the north pole of the projection: 85.0511…°N.
    const state = parseHash("#x=0&y=0&z=0");
    expect(state.center?.[0]).toBe(-180);
    expect(state.center?.[1]).toBeCloseTo(85.0511, 3);
  });

  it("ignores out-of-range tile coordinates", () => {
    const state = parseHash("#x=1&y=1&z=40");
    expect(state.center).toBeUndefined();
    expect(state.zoom).toBeUndefined();
  });

  it("never throws on garbage input", () => {
    expect(parseHash("#zzz=&&&")).toEqual(
      expect.objectContaining({ center: undefined, zoom: undefined }),
    );
  });
});

describe("buildHash", () => {
  it("round-trips center and zoom through parseHash", () => {
    const state = {
      ...DEFAULT_STATE,
      center: [-73.5, 40.7] as [number, number],
      zoom: 8.5,
      // basemap "dark" is the node-env default, so it is omitted from the hash
      basemap: "dark",
    };
    const parsed = parseHash(buildHash(state));
    expect(parsed.center).toEqual([-73.5, 40.7]);
    expect(parsed.zoom).toBe(8.5);
    expect(parsed.basemap).toBeUndefined();
  });

  it("keeps a non-default basemap in the bm parameter", () => {
    const state = { ...DEFAULT_STATE, basemap: "satellite" };
    expect(buildHash(state)).toContain("bm=satellite");
  });

  it("omits bearing and pitch when zero, includes them when set", () => {
    const flat = buildHash({ ...DEFAULT_STATE, bearing: 0, pitch: 0 });
    expect(flat).not.toContain("b=");
    expect(flat).not.toContain("p=");
    const angled = buildHash({ ...DEFAULT_STATE, bearing: 90, pitch: 45 });
    expect(angled).toContain("b=90.0");
    expect(angled).toContain("p=45.0");
  });
});

describe("defaults", () => {
  it("falls back to the dark basemap when window is unavailable", () => {
    expect(getDefaultBasemap()).toBe("dark");
  });

  it("seeds the map-specific layer set and merges only boolean values", () => {
    const layers = buildDefaultLayers();
    expect(layers.hillshade).toBe(true);
    expect(layers.contour).toBe(false);
    expect(layers.terrain3d).toBe(false);
    expect(layers.boundaries).toBe(false);
    for (const value of Object.values(layers)) {
      expect(typeof value).toBe("boolean");
    }
  });

  it("seeds the default view at zoom 2.5 centered on (0, 0)", () => {
    expect(DEFAULT_STATE.center).toEqual([0, 0]);
    expect(DEFAULT_STATE.zoom).toBe(2.5);
    expect(DEFAULT_STATE.bearing).toBe(0);
    expect(DEFAULT_STATE.pitch).toBe(0);
    expect(DEFAULT_STATE.basemap).toBe("satellite");
  });
});
