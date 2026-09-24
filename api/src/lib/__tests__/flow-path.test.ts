import { describe, it, expect, vi, beforeEach } from "vitest";

type BatchPoint = { lat: number; lon: number; id?: string };
type BatchResult = { lat: number; lon: number; elevation: number | null; id?: string };

const batchMock = vi.fn<(points: Array<BatchPoint>) => Promise<Array<BatchResult>>>();

vi.mock("../client-elevation", () => ({
  getClientElevationBatch: (points: Array<BatchPoint>) => batchMock(points),
}));

import {
  calculateSphereDirections,
  computeElevationProfile,
  flowPathToGeoJSON,
  traceDownstream,
  traceUpstream,
  type FlowPathResult,
} from "../flow-path";

/** Serve elevations from a terrain model and record every queried point. */
function terrain(elevationAt: (lat: number, lon: number) => number | null): {
  calls: Array<{ lat: number; lon: number }>;
} {
  const calls: Array<{ lat: number; lon: number }> = [];
  batchMock.mockImplementation((points) => {
    for (const point of points) calls.push({ lat: point.lat, lon: point.lon });
    return Promise.resolve(points.map((point) => ({ ...point, elevation: elevationAt(point.lat, point.lon) })));
  });
  return { calls };
}

beforeEach(() => {
  batchMock.mockReset();
});

/* ─── calculateSphereDirections ─── */

describe("calculateSphereDirections", () => {
  it("returns one entry per side with evenly spaced angles", () => {
    const dirs = calculateSphereDirections(41, -73.5, 0.001, 8);

    expect(dirs).toHaveLength(8);
    expect(dirs.map((d) => d.angleDeg)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
  });

  it("steps north, east, south and west at the equator by radius-in-degrees", () => {
    const dirs = calculateSphereDirections(0, 0, 0.001, 4);

    // north: exactly the requested 0.001 degree (~100 m)
    expect(dirs[0]?.angleDeg).toBe(0);
    expect(dirs[0]?.dLat).toBeCloseTo(0.001, 12);
    expect(dirs[0]?.dLon).toBeCloseTo(0, 15);
    // east
    expect(dirs[1]?.dLat).toBeCloseTo(0, 15);
    expect(dirs[1]?.dLon).toBeCloseTo(0.001, 12);
    // south
    expect(dirs[2]?.dLat).toBeCloseTo(-0.001, 12);
    expect(dirs[2]?.dLon).toBeCloseTo(0, 15);
    // west
    expect(dirs[3]?.dLat).toBeCloseTo(0, 15);
    expect(dirs[3]?.dLon).toBeCloseTo(-0.001, 12);
  });

  it("follows great circles at higher latitudes", () => {
    const dirs = calculateSphereDirections(60, 0, 0.001, 4);

    // due north gains the same latitude offset as at the equator
    expect(dirs[0]?.dLat).toBeCloseTo(0.001, 12);
    expect(dirs[0]?.dLon).toBeCloseTo(0, 15);
    // the great circle due east drops away from the parallel (second order —
    // ~1.5e-8 deg) and its longitude offset is 2x the radius at 60°N, where
    // one degree of longitude spans half a degree of great-circle arc
    expect(dirs[1]?.dLat).toBeCloseTo(-0.0000000151, 10);
    expect(dirs[1]?.dLon).toBeCloseTo(0.002, 10);
    // west mirrors east
    expect(dirs[3]?.dLon).toBeCloseTo(-dirs[1].dLon, 15);
  });

  it("returns no directions when sides is zero", () => {
    expect(calculateSphereDirections(10, 10, 0.002, 0)).toEqual([]);
  });
});

/* ─── computeElevationProfile ─── */

describe("computeElevationProfile", () => {
  it("returns a single zero-distance point for a one point path", () => {
    const profile = computeElevationProfile({ coordinates: [[-73.5, 41]], elevations: [120] });

    expect(profile).toEqual([{ distanceM: 0, elevationM: 120, slope: 0 }]);
  });

  it("returns an empty profile for an empty path", () => {
    expect(computeElevationProfile({ coordinates: [], elevations: [] })).toEqual([]);
  });

  it("accumulates haversine distance and slope along the equator", () => {
    // coordinates are [lon, lat]; one degree of longitude at the equator is
    // 6371000 * pi/180 = 111194.92664455874 m
    const profile = computeElevationProfile({
      coordinates: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      elevations: [100, 110, 85],
    });

    expect(profile).toHaveLength(3);
    expect(profile[0]).toEqual({ distanceM: 0, elevationM: 100, slope: 0.005152733230515655 });
    expect(profile[1]?.distanceM).toBeCloseTo(111194.92664455874, 6);
    expect(profile[1]?.elevationM).toBe(110);
    expect(profile[1]?.slope).toBeCloseTo(-0.012881832893964332, 12);
    expect(profile[2]?.distanceM).toBeCloseTo(222389.85328911748, 6);
    // the last point has no successor, so its slope is zero
    expect(profile[2]?.slope).toBe(0);
  });

  it("weights a degree of longitude by the cosine of the latitude", () => {
    const profile = computeElevationProfile({
      coordinates: [
        [0, 45],
        [1, 45],
      ],
      elevations: [500, 500],
    });

    expect(profile[1]?.distanceM).toBeCloseTo(78626.18767687454, 6);
    expect(profile[1]?.slope).toBe(0);
  });

  it("measures a degree of latitude without a cosine factor", () => {
    const profile = computeElevationProfile({
      coordinates: [
        [10, 20],
        [10, 21],
      ],
      elevations: [0, 0],
    });

    expect(profile[1]?.distanceM).toBeCloseTo(111194.92664455874, 6);
  });
});

/* ─── flowPathToGeoJSON ─── */

describe("flowPathToGeoJSON", () => {
  it("builds a LineString feature with summary properties", () => {
    const result: FlowPathResult = {
      coordinates: [
        [-73.5, 41],
        [-72.5, 41],
      ],
      elevations: [100, 110],
    };

    const feature = flowPathToGeoJSON(result, "downstream");

    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("LineString");
    expect(feature.geometry.coordinates).toEqual(result.coordinates);
    expect(feature.properties.mode).toBe("downstream");
    expect(feature.properties.startLat).toBe(41);
    expect(feature.properties.startLon).toBe(-73.5);
    expect(feature.properties.pointCount).toBe(2);
    // one degree of longitude at latitude 41
    expect(feature.properties.totalDistanceM).toBeCloseTo(83919.41795130647, 6);
    expect(feature.properties.minElevM).toBe(100);
    expect(feature.properties.maxElevM).toBe(110);
    expect(feature.properties.elevRangeM).toBe(10);
    expect(feature.properties.elevations).toEqual([100, 110]);
  });

  it("passes the upstream mode through unchanged", () => {
    const feature = flowPathToGeoJSON({ coordinates: [[0, 0]], elevations: [5] }, "upstream");
    expect(feature.properties.mode).toBe("upstream");
  });

  it("reports zeroed properties for an empty path", () => {
    const feature = flowPathToGeoJSON({ coordinates: [], elevations: [] }, "downstream");

    expect(feature.geometry.coordinates).toEqual([]);
    expect(feature.properties.startLat).toBe(0);
    expect(feature.properties.startLon).toBe(0);
    expect(feature.properties.pointCount).toBe(0);
    expect(feature.properties.totalDistanceM).toBe(0);
    expect(feature.properties.minElevM).toBe(0);
    expect(feature.properties.maxElevM).toBe(0);
    expect(feature.properties.elevRangeM).toBe(0);
  });
});

/* ─── traceDownstream / traceUpstream ─── */

describe("traceDownstream", () => {
  it("returns an empty path when the start elevation is unknown", async () => {
    terrain(() => null);

    const result = await traceDownstream(41, -73.5);

    expect(result).toEqual({ coordinates: [], elevations: [] });
    expect(result.agl).toBeUndefined();
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0]?.[0]).toEqual([{ lat: 41, lon: -73.5 }]);
  });

  it("returns only the start point when it sits at or below sea level", async () => {
    const { calls } = terrain(() => -5);

    const result = await traceDownstream(41, -73.5);

    expect(result.coordinates).toEqual([[-73.5, 41]]);
    expect(result.elevations).toEqual([-5]);
    // the sea-level stop fires before any neighbour is queried
    expect(calls).toHaveLength(1);
  });

  it("skips the sea-level stop when stopAtSeaLevel is false", async () => {
    terrain(() => -5);

    const result = await traceDownstream(41, -73.5, undefined, { stopAtSeaLevel: false, maxPoints: 2 });

    // without the stop the trace keeps walking the seabed
    expect(result.coordinates).toHaveLength(2);
    expect(result.elevations).toEqual([-5, -5]);
  });

  it("reports AGL values for the traced path", async () => {
    // only the start point has data, so the path stays a single point
    terrain((lat, lon) => (lat === 41 && lon === -73.5 ? 500 : null));

    const result = await traceDownstream(41, -73.5, 120);

    expect(result.agl).toEqual([120 - 500]);
    expect(result.elevations).toEqual([500]);
  });

  it("descends the terrain gradient until it reaches sea level", async () => {
    // terrain falls 100 m per 0.001 deg eastward: a clear downhill gradient.
    // directions: 0 keeps the compass steps at exact 0.001 multiples.
    const { calls } = terrain((lat, lon) => 1000 - 100 * Math.round((lon + 73.5) / 0.001));

    const result = await traceDownstream(41, -73.5, undefined, { directions: 0 });

    // one point per 100 m level down to the sea-level hit at 0 m
    expect(result.elevations).toEqual([1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 0]);
    const lons = result.coordinates.map(([lon]) => lon);
    for (let i = 1; i < lons.length; i++) {
      expect(lons[i]).toBeGreaterThan(lons[i - 1]);
    }
    // the seed's neighbours were actually queried — more than the start point
    expect(calls.length).toBeGreaterThan(1);
  });

  it("stops at maxPoints on uniform terrain", async () => {
    terrain(() => 250);

    const result = await traceDownstream(41, -73.5, undefined, { maxPoints: 50, directions: 0 });

    expect(result.coordinates).toHaveLength(50);
    expect(result.elevations).toEqual(Array(50).fill(250));
  });
});

describe("traceUpstream", () => {
  it("returns an empty path when the start elevation is unknown", async () => {
    terrain(() => null);

    const result = await traceUpstream(20, 10);

    expect(result).toEqual({ coordinates: [], elevations: [] });
  });

  it("reports AGL values for the traced path", async () => {
    // only the start point has data, so the path stays a single point
    terrain((lat, lon) => (lat === 20 && lon === 10 ? 300 : null));

    const result = await traceUpstream(20, 10, 1000);

    expect(result.agl).toEqual([700]);
    expect(result.elevations).toEqual([300]);
  });

  it("stops at a below-sea-level start point like the downstream trace", async () => {
    terrain(() => -100);

    const result = await traceUpstream(20, 10);

    expect(result.coordinates).toEqual([[10, 20]]);
    expect(result.elevations).toEqual([-100]);
  });

  it("clears the heap when a neighbour is sea level (stop-at-sea neighbour branch)", async () => {
    // The start is land; its first expanded neighbour is the ocean. The
    // neighbour-emission branch runs the same heap.clear() the downstream
    // trace uses — MaxHeap's, on the upstream walk.
    const SEA_LAT = 20 + 0.001;
    terrain((lat, lon) => (lat === SEA_LAT ? -1 : lat === 20 && lon === 10 ? 300 : 500));

    const result = await traceUpstream(20, 10);

    expect(result.elevations[0]).toBe(300);
    expect(result.elevations).toContain(-1); // the sea neighbour is emitted
    expect(result.elevations[result.elevations.length - 1]).toBe(-1);
  });

  it("ascends the terrain gradient until maxPoints", async () => {
    // terrain rises 100 m per 0.001 deg eastward, plateauing well above sea
    // level to the west so the sea-level stop can't fire mid-ascent.
    // directions: 0 keeps the compass steps at exact 0.001 multiples.
    const { calls } = terrain((lat, lon) => 250 + 100 * Math.round((lon - 10) / 0.001));

    const result = await traceUpstream(20, 10, undefined, { directions: 0, maxPoints: 11 });

    // climbs one 100 m level per step, eastward, without revisiting
    expect(result.elevations).toEqual([250, 350, 450, 550, 650, 750, 850, 950, 1050, 1150, 1250]);
    const lons = result.coordinates.map(([lon]) => lon);
    for (let i = 1; i < lons.length; i++) {
      expect(lons[i]).toBeGreaterThanOrEqual(lons[i - 1]);
    }
    expect(calls.length).toBeGreaterThan(1);
  });
});
