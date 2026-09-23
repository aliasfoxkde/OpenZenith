/**
 * ISS position lookup for the "fly to ISS" camera action.
 *
 * The TLE comes from CelesTrak through the API proxy — a third-party
 * payload whose shape must be validated before it reaches
 * satellite.js. The satellite.js object itself is loaded from a CDN
 * onto `window`, so it is accepted here as a structural interface
 * rather than an import.
 */

export interface CelestrakTle {
  TLE_LINE1: string;
  TLE_LINE2: string;
}

/**
 * Extract a usable two-line element set from a CelesTrak JSON response.
 * Returns undefined for anything that is not an array whose first entry
 * carries both TLE lines.
 */
export function parseCelestrakTle(data: unknown): CelestrakTle | undefined {
  if (!Array.isArray(data) || data.length === 0) return undefined;
  const first = data[0] as Partial<CelestrakTle> | null | undefined;
  if (!first?.TLE_LINE1 || !first.TLE_LINE2) return undefined;
  return { TLE_LINE1: first.TLE_LINE1, TLE_LINE2: first.TLE_LINE2 };
}

/** ECEF position in kilometers (satellite.js `eciToEcf` output). */
export interface EcfPosition {
  x: number;
  y: number;
  z: number;
}

/** The subset of the satellite.js API the ISS lookup needs. */
export interface SatelliteJsLike {
  twoline2satrec(line1: string, line2: string): unknown;
  /** Mirrors satellite.js: `position` is `false` when SGP4 fails for the epoch. */
  propagate(satrec: unknown, at: Date): { position?: EcfPosition | false };
  gstime(at: Date): number;
  eciToEcf(eci: EcfPosition, gmst: number): EcfPosition;
}

/**
 * Compute the ISS position in ECEF kilometers for a time, or undefined
 * when SGP4 propagation reports no position for that epoch.
 */
export function issEcfPosition(
  satJs: SatelliteJsLike,
  tle: CelestrakTle,
  at: Date,
): EcfPosition | undefined {
  const satrec = satJs.twoline2satrec(tle.TLE_LINE1, tle.TLE_LINE2);
  const pos = satJs.propagate(satrec, at);
  const eci = pos.position;
  if (!eci) return undefined;
  const gmst = satJs.gstime(at);
  return satJs.eciToEcf(eci, gmst);
}
