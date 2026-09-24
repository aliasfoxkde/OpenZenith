/**
 * Hypsometric color ramp for elevation rendering.
 *
 * Shared by the elevation-color tile route; kept out of the route module
 * because Next.js route files may only export route handlers and config.
 */

/** Compact ramp definition: [elevation_m, R, G, B] stops, strictly ascending. */
const COLOR_STOPS: Array<[number, number, number, number]> = [
  [-500, 0, 0, 68], // deep ocean
  [-100, 8, 48, 107], // ocean
  [0, 8, 48, 107], // sea level
  [10, 33, 113, 181], // coastline
  [50, 103, 169, 207], // low coast
  [100, 65, 182, 196], // near-shore transition
  [200, 35, 139, 69], // lowland green
  [500, 65, 171, 93], // green hills
  [800, 144, 190, 109], // rolling
  [1000, 237, 248, 177], // foothills
  [1500, 255, 237, 160], // lower mountain
  [2000, 254, 178, 76], // mountain
  [2500, 253, 141, 60], // high mountain
  [3000, 240, 59, 32], // alpine
  [4000, 189, 0, 38], // very high
  [5000, 128, 0, 0], // extreme
  [6000, 150, 130, 120], // rocky peaks
  [7000, 200, 190, 180], // high peaks
  [8000, 230, 225, 220], // snow line
  [8849, 255, 255, 255], // Everest+
];

/**
 * Map a single elevation to its hypsometric RGB. The tile encoder guards
 * NoData before calling; the sentinel short-circuits to black here so direct
 * callers stay safe.
 */
export function lerpColor(elevation: number): [number, number, number] {
  const NODATA = -32768;
  if (elevation === NODATA) return [0, 0, 0];

  // Clamp to ramp range
  const e = Math.max(-500, Math.min(8849, elevation));

  // Find surrounding stops
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [e0, r0, g0, b0] = COLOR_STOPS[i];
    const [e1, r1, g1, b1] = COLOR_STOPS[i + 1];
    if (e >= e0 && e <= e1) {
      if (e1 === e0) return [r0, g0, b0];
      const t = (e - e0) / (e1 - e0);
      return [Math.round(r0 + (r1 - r0) * t), Math.round(g0 + (g1 - g0) * t), Math.round(b0 + (b1 - b0) * t)];
    }
  }

  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  return [last[1], last[2], last[3]];
}
