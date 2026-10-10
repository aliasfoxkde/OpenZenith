/**
 * Unit tests for the terrain-sampler's tile-window bounds helper.
 *
 * The route suites in src/app/api/__tests__/terrain-routes.test.ts pin the
 * profile/trace outputs end-to-end; this file pins `tileWindowBounds` itself —
 * the inclusive window of tiles a (2r+1)×(2r+1) pixel grid around a point
 * covers — including the tile-edge crossings the trace termination suites
 * depend on to walk runs off a served window.
 */
import { describe, expect, it } from "vitest";
import { tileWindowBounds } from "@/lib/terrain-sampler";
import { latLonToTile } from "@/lib/srtm/zoom-math";

describe("tileWindowBounds", () => {
  it("pins the trace route's default window (r=50 at 40.7/-74.0, z10)", () => {
    // Hand-derived from the slippy math the routes carried inline: tile
    // 301/385 pixel (130.85, 13.4) minus a 50px radius lands the 101px grid
    // inside tile column 301 but across tile rows 384/385.
    expect(tileWindowBounds(10, 40.7, -74.0, 50)).toEqual({
      tileXMin: 301,
      tileXMax: 301,
      tileYMin: 384,
      tileYMax: 385,
    });
  });

  it("keeps a small radius inside the centre tile", () => {
    const { x: cx, y: cy } = latLonToTile(40.0, -74.0, 10);
    const b = tileWindowBounds(10, 40.0, -74.0, 10);
    expect(b.tileXMin).toBe(cx);
    expect(b.tileXMax).toBe(cx);
    expect(b.tileYMin).toBe(cy);
    expect(b.tileYMax).toBe(cy);
  });

  it("crosses into the eastern neighbour when the grid leaves the tile", () => {
    // 39.0/-74.1878 sits 5.9px from its tile's east edge (tile 300/x, local
    // pixel x 250.1): a 101px-wide grid must reach into tile column 301.
    const b = tileWindowBounds(10, 39.0, -74.1878, 50);
    expect(b.tileXMin).toBe(300);
    expect(b.tileXMax).toBe(301);
  });

  it("crosses into the northern neighbour when the grid leaves the tile", () => {
    // 41.508269/-74.0 sits 0.3px below its tile's north edge (tile y 382): the
    // window must reach up into row 381 — the arm the trace suite's
    // "aborts before stepping" test depends on.
    const b = tileWindowBounds(10, 41.508269, -74.0, 50);
    expect(b.tileYMin).toBe(381);
    expect(b.tileYMax).toBe(382);
  });

  it("spans several tiles at the profile route's 200px clamp", () => {
    const b = tileWindowBounds(10, 40.7, -74.0, 200);
    expect(b.tileXMax - b.tileXMin + 1).toBeGreaterThanOrEqual(2);
    expect(b.tileYMax - b.tileYMin + 1).toBeGreaterThanOrEqual(2);
    const { x: cx, y: cy } = latLonToTile(40.7, -74.0, 10);
    expect(b.tileXMin).toBeLessThanOrEqual(cx);
    expect(b.tileXMax).toBeGreaterThanOrEqual(cx);
    expect(b.tileYMin).toBeLessThanOrEqual(cy);
    expect(b.tileYMax).toBeGreaterThanOrEqual(cy);
  });

  it("always contains the centre tile and covers the whole pixel grid", () => {
    // Property sweep over zooms, hemispheres and radii: the emitted window
    // must (a) include the centre tile and (b) be wide/tall enough to hold
    // every pixel of the (2r+1)² grid the routes sample.
    const points: Array<[number, number]> = [
      [40.7, -74.0],
      [0.5, 0.5],
      [-33.9, 18.4],
      [64.1, -21.9],
      [85.0, 179.9],
      [-85.0, -179.9],
    ];
    for (const z of [5, 10, 14]) {
      for (const [lat, lon] of points) {
        const { x: cx, y: cy } = latLonToTile(lat, lon, z);
        for (const r of [0, 1, 10, 50, 200]) {
          const b = tileWindowBounds(z, lat, lon, r);
          expect(b.tileXMin).toBeLessThanOrEqual(cx);
          expect(b.tileXMax).toBeGreaterThanOrEqual(cx);
          expect(b.tileYMin).toBeLessThanOrEqual(cy);
          expect(b.tileYMax).toBeGreaterThanOrEqual(cy);
          expect((b.tileXMax - b.tileXMin + 1) * 256).toBeGreaterThanOrEqual(2 * r + 1);
          expect((b.tileYMax - b.tileYMin + 1) * 256).toBeGreaterThanOrEqual(2 * r + 1);
        }
      }
    }
  });
});
