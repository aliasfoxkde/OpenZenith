/**
 * Shared query-parameter handling for the elevation endpoints
 * (`/api/elevation`, `/api/elevation/batch`).
 *
 * The three options are independent and additive to the existing response:
 * `interpolation` picks how the DEM grid is sampled, `units` picks the unit
 * the value is reported in, and `datum` picks the vertical reference. Defaults
 * reproduce the behaviour the endpoints had before these parameters existed.
 */

export type Interpolation = "nearest" | "bilinear";
export type ElevationUnits = "meters" | "feet";
export type VerticalDatum = "egm96" | "ellipsoid";

export interface ElevationParams {
  interpolation: Interpolation;
  units: ElevationUnits;
  datum: VerticalDatum;
}

/** Parse failure carries the message; each route wraps it in its own shape. */
export type ElevationParamsResult =
  | { ok: true; params: ElevationParams }
  | { ok: false; message: string };

/** International foot — the unit US surveying clients expect by default. */
const METERS_PER_FOOT = 0.3048;

/** SRTM samples are EGM96 orthometric, so that datum is the identity. */
export const DEFAULT_ELEVATION_PARAMS: ElevationParams = {
  interpolation: "bilinear",
  units: "meters",
  datum: "egm96",
};

/**
 * Read `interpolation`, `units` and `datum` from a query string.
 *
 * Anything unset falls back to the default; anything set to an unsupported
 * value is a 400, not a silent fallback — a client asking for `feet` and
 * quietly getting metres would draw the wrong building height.
 */
export function parseElevationParams(searchParams: URLSearchParams): ElevationParamsResult {
  const params: ElevationParams = { ...DEFAULT_ELEVATION_PARAMS };

  const interpolation = searchParams.get("interpolation");
  if (interpolation !== null) {
    if (interpolation !== "nearest" && interpolation !== "bilinear") {
      return { ok: false, message: "interpolation must be 'nearest' or 'bilinear'" };
    }
    params.interpolation = interpolation;
  }

  const units = searchParams.get("units");
  if (units !== null) {
    if (units !== "meters" && units !== "feet") {
      return { ok: false, message: "units must be 'meters' or 'feet'" };
    }
    params.units = units;
  }

  const datum = searchParams.get("datum");
  if (datum !== null) {
    if (datum !== "egm96" && datum !== "ellipsoid") {
      return { ok: false, message: "datum must be 'egm96' or 'ellipsoid'" };
    }
    params.datum = datum;
  }

  return { ok: true, params };
}

/**
 * Round to 0.1 m — the precision the DEM sources and the geoid grid can
 * actually support; more digits would imply an accuracy that is not there.
 */
function round10(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Present a raw orthometric sample in the requested datum and unit.
 *
 * @param elevationMeters - Raw source sample in EGM96 orthometric metres.
 * @param undulationMeters - EGM96 undulation N at the point (ignored for egm96).
 * @param params - Effective request parameters.
 * @returns The reported height, in the requested unit.
 */
export function presentElevation(
  elevationMeters: number,
  undulationMeters: number,
  params: ElevationParams,
): number {
  // SRTM is orthometric already; ellipsoidal height is h = H + N.
  const metres = params.datum === "ellipsoid" ? elevationMeters + undulationMeters : elevationMeters;
  return params.units === "feet" ? round10(metres / METERS_PER_FOOT) : round10(metres);
}

/**
 * Convert metres to the requested unit without rounding to 0.1 — used for the
 * metadata echo, where the raw sample is preserved exactly.
 */
export function convertUnits(metres: number, units: ElevationUnits): number {
  return units === "feet" ? metres / METERS_PER_FOOT : metres;
}
