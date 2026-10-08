import { describe, expect, it } from "vitest";
import { lerpColor } from "../hypsometric";

/**
 * Tests for the hypsometric ramp shared with the elevation-color tile route.
 *
 * The expectations below are the hand-computed values of the COLOR_STOPS table
 * in src/lib/hypsometric.ts, so a ramp edit that silently shifts a band fails
 * here instead of repainting every served tile.
 */
describe("lerpColor", () => {
  it("maps the nodata sentinel to black", () => {
    expect(lerpColor(-32768)).toEqual([0, 0, 0]);
  });

  it("clamps elevations below the deepest ocean stop", () => {
    expect(lerpColor(-11000)).toEqual([0, 0, 68]);
    expect(lerpColor(-500)).toEqual([0, 0, 68]);
  });

  it("clamps elevations above the highest stop", () => {
    expect(lerpColor(8849)).toEqual([255, 255, 255]);
    expect(lerpColor(9000)).toEqual([255, 255, 255]);
  });

  it("returns the exact stop colour at a stop elevation", () => {
    expect(lerpColor(0)).toEqual([8, 48, 107]);
    expect(lerpColor(1000)).toEqual([237, 248, 177]);
  });

  it("interpolates inside the ocean ramp", () => {
    // 62.5% of the way from the -500m stop [0,0,68] to the -100m stop [8,48,107]
    expect(lerpColor(-250)).toEqual([5, 30, 92]);
  });

  it("interpolates inside the coastal ramp", () => {
    // 37.5% of the way from the 10m stop [33,113,181] to the 50m stop [103,169,207]
    expect(lerpColor(25)).toEqual([59, 134, 191]);
  });

  it("interpolates inside the highland ramp", () => {
    // midpoint of the 200m stop [35,139,69] and the 500m stop [65,171,93]
    expect(lerpColor(350)).toEqual([50, 155, 81]);
  });

  it("keeps every returned channel inside the 0-255 byte range", () => {
    for (let elevation = -600; elevation <= 9000; elevation += 50) {
      const [r, g, b] = lerpColor(elevation);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });
});
