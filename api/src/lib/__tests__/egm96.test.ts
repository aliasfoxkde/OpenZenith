import { describe, it, expect } from "vitest";
import { egm96Undulation, egm96UndulationAt, loadEgm96Grid, resetEgm96Grid } from "../egm96";
import { EGM96_GRID_COLS, EGM96_GRID_ROWS } from "../egm96-grid";

/**
 * Reference values were taken from the `egm96` pip package, which bundles the
 * full 5' EGM96 model and interpolates it to <0.06 m. The bundled grid is the
 * 30' decimation of that source, so bilinear between 30' nodes carries a
 * documented approximation: max 1.91 m, p99 0.53 m globally (measured over
 * 20,000 random points at generation time). Spots carry their own tolerance:
 * 1.5 m is the contract the grid was sized for, and the two extreme-node
 * probes get 2 m because a sharp maximum is exactly where bilinear between
 * 30' nodes undershoots furthest.
 */
const TOLERANCE_M = 1.5;
const EXTREME_TOLERANCE_M = 2.0;

const SPOTS: Array<[string, number, number, number, number?]> = [
  // name, lat, lon, 5' EGM96 undulation (m)
  ["mid-ocean Pacific", 0, -140, 0.67],
  ["Mount Everest summit", 27.9881, 86.925, -28.755],
  ["Dead Sea shore", 31.5, 35.47, 19.098],
  ["Indian Ocean geoid low", -5, 75, -90.02],
  ["Iceland geoid high", 64.9, -18.5, 67.254],
  ["New Guinea geoid high", -3.5, 141, 76.63],
  ["antimeridian east side", 12, 179.9, 10.922],
  ["antimeridian west side", 12, -179.9, 10.73],
  ["north pole (lat clamp)", 90, 0, 13.61],
  ["south of India minimum", 4.5, 75.5, -102.16],
  ["global minimum node", 4.583, 78.833, -107.04, EXTREME_TOLERANCE_M],
  ["global maximum node", -8.167, 147.25, 85.42, EXTREME_TOLERANCE_M],
];

describe("EGM96 undulation", () => {
  it("matches the 5' source within the documented 30' tolerance", async () => {
    await loadEgm96Grid();
    for (const [name, lat, lon, expected, tolerance = TOLERANCE_M] of SPOTS) {
      const n = egm96Undulation(lat, lon);
      // Absolute difference, not toBeCloseTo: the tolerance is metres of geoid
      // error, not decimal places.
      expect(Math.abs(n - expected), `${name}: N=${n} expected ${expected}`).toBeLessThan(tolerance);
    }
  });

  it("is node-exact: the stored node equals the EGM96 value at that node", async () => {
    // These three nodes were checked against the source at generation time.
    await loadEgm96Grid();
    expect(egm96Undulation(0, 0)).toBeCloseTo(17.16, 2);
    expect(egm96Undulation(27.5, 86.5)).toBeCloseTo(-39.13, 2);
    expect(egm96Undulation(-33, 151)).toBeCloseTo(26.02, 2);
  });

  it("wraps longitude across the antimeridian instead of reading column -1", async () => {
    await loadEgm96Grid();
    // +180° maps onto -180°, so the two sides of the seam agree.
    expect(egm96Undulation(12, 180)).toBeCloseTo(egm96Undulation(12, -180), 6);
    // Just inside either side, the field is continuous to within the 30' step.
    expect(Math.abs(egm96Undulation(12, 179.9) - egm96Undulation(12, -179.9))).toBeLessThan(1.5);
  });

  it("clamps latitude instead of indexing past the poles", async () => {
    await loadEgm96Grid();
    expect(egm96Undulation(90, 0)).toBeCloseTo(egm96Undulation(89.9, 0), 0);
    expect(egm96Undulation(-90, 0)).toBeCloseTo(egm96Undulation(-89.9, 0), 0);
    expect(egm96Undulation(95, 0)).toBe(egm96Undulation(90, 0));
  });

  it("stays inside the published EGM96 envelope everywhere", async () => {
    await loadEgm96Grid();
    for (let lat = -90; lat <= 90; lat += 7.5) {
      for (let lon = -180; lon < 180; lon += 11) {
        const n = egm96Undulation(lat, lon);
        expect(n).toBeGreaterThan(-110);
        expect(n).toBeLessThan(90);
      }
    }
  });

  it("reproduces the documented geoid extremes", async () => {
    await loadEgm96Grid();
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < EGM96_GRID_ROWS; i++) {
      for (let j = 0; j < EGM96_GRID_COLS; j++) {
        const n = egm96Undulation(90 - i * 0.5, -180 + j * 0.5);
        if (n < min) min = n;
        if (n > max) max = n;
      }
    }
    // The Indian Ocean low (-107 m) and the New Guinea high (+85 m) are the
    // textbook EGM96 extremes; missing either means the decode is wrong.
    expect(min).toBeLessThan(-105);
    expect(max).toBeGreaterThan(83);
  });

  it("decodes lazily and refuses to sample before the grid is resident", async () => {
    resetEgm96Grid();
    expect(() => egm96Undulation(0, 0)).toThrow(/not loaded/);
    // First call decodes, later calls reuse the same grid.
    expect(await egm96UndulationAt(0, -140)).toBeCloseTo(0.67, 0);
    expect(await egm96UndulationAt(0, -140)).toBe(egm96Undulation(0, -140));
  });

  it("decodes the embedded payload twice to the same values", async () => {
    const first = await egm96UndulationAt(27.9881, 86.925);
    resetEgm96Grid();
    expect(await egm96UndulationAt(27.9881, 86.925)).toBe(first);
  });
});
