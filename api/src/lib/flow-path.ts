/**
 * Flow Path Tracing — A* elevation pathfinding
 *
 * Traces downstream (lowest elevation) or upstream (highest elevation) paths
 * from a starting point using an A* priority queue with spherical direction
 * sampling. Uses client-side SRTM elevation data for terrain queries.
 */

import { getClientElevationBatch } from "./client-elevation";

/* ─── Spherical Geometry ─── */

/**
 * Generate N directions uniformly on a sphere centered on a point.
 * Returns fractional lat/lon offsets from the center point.
 * @param lat - Center latitude (degrees)
 * @param lon - Center longitude (degrees)
 * @param radiusDeg - Angular radius in degrees
 * @param sides - Number of directions (e.g., 8, 16, 90, 360)
 */
export function calculateSphereDirections(
  centerLat: number,
  centerLon: number,
  radiusDeg: number,
  sides: number,
): Array<{ dLat: number; dLon: number; angleDeg: number }> {
  const results: Array<{ dLat: number; dLon: number; angleDeg: number }> = [];
  const sinCenterLat = Math.sin((centerLat * Math.PI) / 180);
  const cosCenterLat = Math.cos((centerLat * Math.PI) / 180);

  for (let i = 0; i < sides; i++) {
    const angleDeg = (360 * i) / sides;
    const angleRad = (angleDeg * Math.PI) / 180;

    const sinRadius = Math.sin(radiusDeg);
    const cosRadius = Math.cos(radiusDeg);

    const lat = Math.asin(
      sinCenterLat * cosRadius + cosCenterLat * sinRadius * Math.cos(angleRad),
    );

    const lonOffset = Math.atan2(
      Math.sin(angleRad) * sinRadius * cosCenterLat,
      cosRadius - sinCenterLat * Math.sin(lat),
    );

    results.push({
      dLat: (lat * 180) / Math.PI - centerLat,
      dLon: (lonOffset * 180) / Math.PI,
      angleDeg,
    });
  }

  return results;
}

/* ─── Simple Min-Heap Priority Queue ─── */

interface HeapNode {
  elevation: number; // terrain elevation in meters
  lat: number;
  lon: number;
}

class MinHeap {
  private heap: HeapNode[] = [];

  push(node: HeapNode): void {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): HeapNode | undefined {
    if (this.heap.length === 0) return undefined;
    const min = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return min;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  get size(): number {
    return this.heap.length;
  }

  clear(): void {
    this.heap = [];
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].elevation <= this.heap[i].elevation) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const length = this.heap.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;

      if (left < length && this.heap[left].elevation < this.heap[smallest].elevation) {
        smallest = left;
      }
      if (right < length && this.heap[right].elevation < this.heap[smallest].elevation) {
        smallest = right;
      }
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

class MaxHeap {
  private heap: HeapNode[] = [];

  push(node: HeapNode): void {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): HeapNode | undefined {
    if (this.heap.length === 0) return undefined;
    const max = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return max;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  clear(): void {
    this.heap = [];
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].elevation >= this.heap[i].elevation) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const length = this.heap.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let largest = i;

      if (left < length && this.heap[left].elevation > this.heap[largest].elevation) {
        largest = left;
      }
      if (right < length && this.heap[right].elevation > this.heap[largest].elevation) {
        largest = right;
      }
      if (largest === i) break;
      [this.heap[i], this.heap[largest]] = [this.heap[largest], this.heap[i]];
      i = largest;
    }
  }
}

/* ─── Core Algorithm ─── */

export interface FlowPathOptions {
  /** Search radius in degrees (default: 0.001 ≈ 100m) */
  precision?: number;
  /** Number of directions to search (default: 16) */
  directions?: number;
  /** Maximum number of points in the path (default: 2000) */
  maxPoints?: number;
  /** Stop at elevation <= 0 (sea level) (default: true) */
  stopAtSeaLevel?: boolean;
}

export interface FlowPathResult {
  /** Ordered coordinates [lon, lat] of the path */
  coordinates: [number, number][];
  /** Elevation at each point (meters) */
  elevations: number[];
  /** AGLevel at each point (drone_alt - terrain_alt) if available */
  agl?: number[];
}

/**
 * Trace a downstream flow path from a starting point.
 * Uses A* with a min-heap (lowest elevation = highest priority).
 * Higher neighbors get explored first — water flows downhill.
 *
 * @param lat - Starting latitude
 * @param lon - Starting longitude
 * @param droneAltM - Optional drone altitude AGL for AGL calculation
 * @param options - Search options
 * @returns Flow path coordinates and elevations
 */
export async function traceDownstream(
  lat: number,
  lon: number,
  droneAltM?: number,
  options: FlowPathOptions = {},
): Promise<FlowPathResult> {
  const { precision = 0.001, directions = 16, maxPoints = 2000, stopAtSeaLevel = true } = options;
  return traceFlowPath(lat, lon, droneAltM, "downstream", options);
}

/**
 * Trace an upstream (reverse) flow path from a starting point.
 * Uses A* with a max-heap (highest elevation = highest priority).
 * Lower neighbors get explored first — trace the ridgeline/drainage divide.
 *
 * @param lat - Starting latitude
 * @param lon - Starting longitude
 * @param droneAltM - Optional drone altitude AGL for AGL calculation
 * @param options - Search options
 * @returns Flow path coordinates and elevations
 */
export async function traceUpstream(
  lat: number,
  lon: number,
  droneAltM?: number,
  options: FlowPathOptions = {},
): Promise<FlowPathResult> {
  const { precision = 0.001, directions = 16, maxPoints = 2000 } = options;
  return traceFlowPath(lat, lon, droneAltM, "upstream", options);
}

/**
 * Core A* flow path algorithm.
 * Queries elevation on-demand (client-elevation handles its own tile caching/batching).
 * @param mode "downstream" = min-heap (lowest elev first), "upstream" = max-heap
 */
async function traceFlowPath(
  lat: number,
  lon: number,
  droneAltM: number | undefined,
  mode: "downstream" | "upstream",
  options: FlowPathOptions,
): Promise<FlowPathResult> {
  const { precision = 0.001, directions = 16, maxPoints = 2000, stopAtSeaLevel = true } = options;

  // Direction offsets: 8 compass + N spherical
  const dirs8 = [
    { dLat: -precision, dLon: 0 },
    { dLat: -precision, dLon: precision },
    { dLat: 0, dLon: precision },
    { dLat: precision, dLon: precision },
    { dLat: precision, dLon: 0 },
    { dLat: precision, dLon: -precision },
    { dLat: 0, dLon: -precision },
    { dLat: -precision, dLon: -precision },
  ];
  const dirsN = calculateSphereDirections(lat, lon, precision, directions);

  const heap = mode === "downstream" ? new MinHeap() : new MaxHeap();
  const visited = new Set<string>();
  const visitedKey = (la: number, lo: number) => `${la.toFixed(6)},${lo.toFixed(6)}`;

  // Get starting elevation and seed the heap
  const startResult = await getClientElevationBatch([{ lat, lon }]);
  const startElev = startResult[0]?.elevation;
  if (startElev === null || startElev === undefined) {
    return { coordinates: [], elevations: [] };
  }
  if (startElev <= 0 && stopAtSeaLevel) {
    return { coordinates: [[lon, lat]], elevations: [startElev] };
  }
  visited.add(visitedKey(lat, lon));
  heap.push({ elevation: startElev, lat, lon });

  const pathCoords: [number, number][] = [[lon, lat]];
  const pathElevs: number[] = [startElev];

  while (!heap.isEmpty() && pathCoords.length < maxPoints) {
    const node = heap.pop()!;
    const nKey = visitedKey(node.lat, node.lon);
    if (visited.has(nKey)) continue;
    visited.add(nKey);
    pathCoords.push([node.lon, node.lat]);
    pathElevs.push(node.elevation);

    if (node.elevation <= 0 && stopAtSeaLevel) break;

    // Expand all neighbors
    const allDirs = [...dirs8, ...dirsN];
    for (const d of allDirs) {
      const nLat = node.lat + d.dLat;
      const nLon = node.lon + d.dLon;
      const k = visitedKey(nLat, nLon);
      if (visited.has(k)) continue;
      visited.add(k);

      const results = await getClientElevationBatch([{ lat: nLat, lon: nLon }]);
      const elev = results[0]?.elevation;
      if (elev === null || elev === undefined) continue;
      if (elev <= 0 && stopAtSeaLevel) {
        pathCoords.push([nLon, nLat]);
        pathElevs.push(elev);
        heap.clear();
        break;
      }
      heap.push({ elevation: elev, lat: nLat, lon: nLon });
    }
  }

  let agl: number[] | undefined;
  if (droneAltM !== undefined) {
    agl = pathElevs.map((e) => droneAltM - e);
  }

  return { coordinates: pathCoords, elevations: pathElevs, agl };
}

/* ─── Elevation Profile from Flow Path ─── */

export interface ElevationProfilePoint {
  distanceM: number; // cumulative distance in meters
  elevationM: number;
  slope: number; // slope in degrees to next point
}

/**
 * Compute an elevation profile (distance + slope) from a flow path result.
 */
export function computeElevationProfile(result: FlowPathResult): ElevationProfilePoint[] {
  const profile: ElevationProfilePoint[] = [];
  let cumulativeDist = 0;

  for (let i = 0; i < result.elevations.length; i++) {
    if (i > 0) {
      const [lon1, lat1] = result.coordinates[i - 1];
      const [lon2, lat2] = result.coordinates[i];
      cumulativeDist += haversineMeters(lat1, lon1, lat2, lon2);
    }

    let slope = 0;
    if (i < result.elevations.length - 1) {
      const dElev = result.elevations[i + 1] - result.elevations[i];
      const dDist = haversineMeters(
        result.coordinates[i][1],
        result.coordinates[i][0],
        result.coordinates[i + 1][1],
        result.coordinates[i + 1][0],
      );
      if (dDist > 0) {
        slope = Math.atan2(dElev, dDist) * (180 / Math.PI);
      }
    }

    profile.push({ distanceM: cumulativeDist, elevationM: result.elevations[i], slope });
  }

  return profile;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ─── Flow Path as GeoJSON ─── */

export interface FlowPathGeoJSON {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  properties: {
    mode: "downstream" | "upstream";
    startLat: number;
    startLon: number;
    pointCount: number;
    totalDistanceM: number;
    minElevM: number;
    maxElevM: number;
    elevRangeM: number;
    elevations: number[];
  };
}

/**
 * Convert a FlowPathResult to a GeoJSON Feature with properties.
 */
export function flowPathToGeoJSON(
  result: FlowPathResult,
  mode: "downstream" | "upstream",
): FlowPathGeoJSON {
  const totalDist = computeTotalDistance(result);
  const minElev = result.elevations.length > 0 ? Math.min(...result.elevations) : 0;
  const maxElev = result.elevations.length > 0 ? Math.max(...result.elevations) : 0;

  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: result.coordinates,
    },
    properties: {
      mode,
      startLat: result.coordinates[0]?.[1] ?? 0,
      startLon: result.coordinates[0]?.[0] ?? 0,
      pointCount: result.elevations.length,
      totalDistanceM: totalDist,
      minElevM: minElev,
      maxElevM: maxElev,
      elevRangeM: maxElev - minElev,
      elevations: result.elevations,
    },
  };
}

function computeTotalDistance(result: FlowPathResult): number {
  let total = 0;
  for (let i = 1; i < result.coordinates.length; i++) {
    const [lon1, lat1] = result.coordinates[i - 1];
    const [lon2, lat2] = result.coordinates[i];
    total += haversineMeters(lat1, lon1, lat2, lon2);
  }
  return total;
}
