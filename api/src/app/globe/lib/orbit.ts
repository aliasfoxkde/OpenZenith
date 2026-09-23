/**
 * Orbit classification for selected satellites.
 *
 * Derived purely from altitude so the satellite panel never needs the
 * raw TLE data to describe the regime a satellite flies in.
 */

export type OrbitClass = "LEO" | "MEO" | "GEO" | "Unknown";

/** Classify an orbit regime from altitude in kilometers. */
export function classifyOrbit(altKm: number): OrbitClass {
  if (altKm < 2000) return "LEO";
  if (altKm > 30000) return "GEO";
  return "MEO";
}

/**
 * Circular-orbit velocity in km/s for an altitude in kilometers.
 * GEO satellites ride Earth's synchronous rotation (3.07 km/s); anything
 * else falls out of the vis-viva approximation around a 6371 km Earth.
 */
export function orbitalVelocityKms(altKm: number): number {
  if (altKm > 30000) return 3.07;
  return +(7.66 / Math.sqrt(1 + altKm / 6371)).toFixed(2);
}
