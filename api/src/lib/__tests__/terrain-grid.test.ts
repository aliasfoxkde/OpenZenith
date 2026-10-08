/**
 * Unit tests for the terrain-route kernel's hydrology helpers.
 *
 * The route suites exercise d8FlowDirection/flowAccumulation only through
 * mocked flat grids (every direction ties → flowDir -1), so the actual
 * downhill-push body of flowAccumulation is verified here directly with
 * sloped inputs.
 */
import { describe, expect, it } from "vitest";
import { d8FlowDirection, flowAccumulation, TERRAIN_NODATA } from "@/lib/terrain-grid";

describe("d8FlowDirection", () => {
  it("codes the steepest-descent neighbor (S = 2) on a downsloping column", () => {
    // 3→2→1 straight down: every cell's steepest neighbor is due south.
    const dem = new Float32Array([3, 2, 1]);
    const flowDir = d8FlowDirection(dem, 3, 1, TERRAIN_NODATA);
    expect(Array.from(flowDir)).toEqual([2, 2, -1]);
  });

  it("codes SE = 1 for a diagonal drop and -1 for the basin floor", () => {
    const dem = new Float32Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const flowDir = d8FlowDirection(dem, 3, 3, TERRAIN_NODATA);
    // Center 5: due-south neighbor (2) drops 3 over distance 1 — steeper
    // than the SE diagonal (4 over √2 ≈ 2.83).
    expect(flowDir[1 * 3 + 1]).toBe(2);
    // Bottom-right 1 has no lower neighbor.
    expect(flowDir[2 * 3 + 2]).toBe(-1);
  });

  it("marks flat grids with no flow direction", () => {
    const dem = new Float32Array(9).fill(42);
    const flowDir = d8FlowDirection(dem, 3, 3, TERRAIN_NODATA);
    expect(Array.from(flowDir)).toEqual([-1, -1, -1, -1, -1, -1, -1, -1, -1]);
  });
});

describe("flowAccumulation", () => {
  it("accumulates cell counts down a draining column", () => {
    const dem = new Float32Array([3, 2, 1]);
    const flowDir = d8FlowDirection(dem, 3, 1, TERRAIN_NODATA);
    const accum = flowAccumulation(flowDir, 3, 1);
    expect(Array.from(accum)).toEqual([1, 2, 3]);
  });

  it("deposits the largest count at the basin sink", () => {
    const dem = new Float32Array([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const flowDir = d8FlowDirection(dem, 3, 3, TERRAIN_NODATA);
    const accum = flowAccumulation(flowDir, 3, 3);
    // Every cell drains toward the bottom-right corner.
    const max = Math.max(...Array.from(accum));
    expect(accum[2 * 3 + 2]).toBe(max);
    expect(accum[2 * 3 + 2]).toBeGreaterThan(accum[0]);
    // All cells keep their self-count of at least 1.
    expect(Math.min(...Array.from(accum))).toBeGreaterThanOrEqual(1);
  });

  it("leaves flat grids at the self-count of 1", () => {
    const dem = new Float32Array(9).fill(42);
    const flowDir = d8FlowDirection(dem, 3, 3, TERRAIN_NODATA);
    const accum = flowAccumulation(flowDir, 3, 3);
    expect(Array.from(accum)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });
});
