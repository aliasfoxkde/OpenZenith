import { describe, expect, it } from "vitest";
import {
  issEcfPosition,
  parseCelestrakTle,
  type SatelliteJsLike,
} from "../iss";

const VALID_TLE = { TLE_LINE1: "1 25544U", TLE_LINE2: "2 25544 " };

describe("parseCelestrakTle", () => {
  it("accepts an array whose first entry carries both lines", () => {
    expect(parseCelestrakTle([VALID_TLE, { TLE_LINE1: "x" }])).toEqual(VALID_TLE);
  });

  it("rejects non-arrays", () => {
    expect(parseCelestrakTle(VALID_TLE)).toBeUndefined();
    expect(parseCelestrakTle(null)).toBeUndefined();
    expect(parseCelestrakTle(undefined)).toBeUndefined();
    expect(parseCelestrakTle("1 25544U\n2 25544")).toBeUndefined();
  });

  it("rejects empty arrays and entries missing either line", () => {
    expect(parseCelestrakTle([])).toBeUndefined();
    expect(parseCelestrakTle([{}])).toBeUndefined();
    expect(parseCelestrakTle([{ TLE_LINE1: "1 25544U" }])).toBeUndefined();
    expect(parseCelestrakTle([{ TLE_LINE2: "2 25544" }])).toBeUndefined();
    expect(parseCelestrakTle([null])).toBeUndefined();
  });

  it("rejects blank lines", () => {
    expect(parseCelestrakTle([{ TLE_LINE1: "", TLE_LINE2: "2 25544" }])).toBeUndefined();
  });

  it("carries only the two TLE fields through", () => {
    const tle = parseCelestrakTle([{ ...VALID_TLE, OBJECT_NAME: "ISS (ZARYA)", EPOCH: "2026" }]);
    expect(tle).toEqual(VALID_TLE);
  });
});

/** A satellite.js stub that threads known values so the wiring is observable. */
function stubSatJs(overrides: Partial<SatelliteJsLike> = {}): SatelliteJsLike & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    twoline2satrec(line1, line2) {
      calls.push(`twoline2satrec:${line1}:${line2}`);
      return { satrec: true };
    },
    propagate(_satrec, at) {
      calls.push(`propagate:${at.toISOString()}`);
      return { position: { x: 1000, y: 2000, z: 3000 } };
    },
    gstime(at) {
      calls.push(`gstime:${at.toISOString()}`);
      return 1.234;
    },
    eciToEcf(eci, gmst) {
      calls.push(`eciToEcf:${eci.x},${gmst}`);
      return { x: eci.x * 2, y: eci.y * 2, z: eci.z * 2 };
    },
    ...overrides,
  };
}

describe("issEcfPosition", () => {
  const at = new Date("2026-09-22T00:00:00Z");

  it("threads the TLE lines, epoch, and GMST through satellite.js in order", () => {
    const satJs = stubSatJs();
    const pos = issEcfPosition(satJs, VALID_TLE, at);
    expect(satJs.calls).toEqual([
      `twoline2satrec:${VALID_TLE.TLE_LINE1}:${VALID_TLE.TLE_LINE2}`,
      `propagate:${at.toISOString()}`,
      `gstime:${at.toISOString()}`,
      "eciToEcf:1000,1.234",
    ]);
    expect(pos).toEqual({ x: 2000, y: 4000, z: 6000 });
  });

  it("returns undefined when SGP4 reports no position", () => {
    const satJs = stubSatJs({
      propagate: () => ({ position: false }),
    });
    expect(issEcfPosition(satJs, VALID_TLE, at)).toBeUndefined();
  });

  it("propagates the passed epoch, not a hard-coded date", () => {
    const satJs = stubSatJs();
    const later = new Date("2027-01-01T12:00:00Z");
    issEcfPosition(satJs, VALID_TLE, later);
    expect(satJs.calls[1]).toBe(`propagate:${later.toISOString()}`);
  });
});
