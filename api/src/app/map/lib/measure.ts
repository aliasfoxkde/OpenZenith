/**
 * Geodesic measurement utilities for the 2D map.
 * Uses the Vincenty inverse formula for distance and the shoelace formula
 * on a sphere for area. No external dependencies.
 */

import { formatDistance as _fmtDist, formatArea as _fmtArea } from "@/lib/format-units";

/** Format meters into human-readable distance string. */
export function formatDistance(meters: number): string {
  return _fmtDist(meters);
}

/** Format square meters into human-readable area string. */
export function formatArea(sqMeters: number): string {
  return _fmtArea(sqMeters);
}

const R = 6371000; // Earth radius in meters

/** Haversine distance between two lat/lon points in meters. */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Total distance along an array of [lon, lat] points in meters. */
export function pathDistance(coords: [number, number][]): number {
  let total = 0;
  // bounds: loop runs 1 <= i < coords.length, so coords[i - 1] and coords[i] exist
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    total += haversineDistance(a[1], a[0], b[1], b[0]);
  }
  return total;
}

/**
 * Spherical excess area for a polygon in square meters.
 * Works for polygons with 3+ vertices.
 */
export function sphericalPolygonArea(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const n = coords.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // bounds: i < n and j = (i + 1) % n both index inside coords (length n)
    const cur = coords[i]!;
    const next = coords[j]!;
    const lat1 = toRad(cur[1]);
    const lat2 = toRad(next[1]);
    const dLon = toRad(next[0] - cur[0]);
    sum += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs((sum * R * R) / 2);
}

/** Initial bearing between two points in degrees (0 = north). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** The active measure tool: `none` clears the overlay, `distance` draws a path, `area` closes it into a polygon. */
export type MeasureMode = "none" | "distance" | "area";

/** Current measure-tool state: the mode plus the vertices clicked so far as [lon, lat] pairs in click order. */
export interface MeasureState {
  mode: MeasureMode;
  points: [number, number][]; // [lon, lat]
}

/**
 * Build the draw/render half of the measure tool. The returned object owns
 * the `measure-points` GeoJSON source plus three layers (`measure-fill` for
 * closed area polygons, `measure-line` for the dashed path, `measure-
 * vertices` for the clicked points) on whichever map addLayers is called
 * with. `updateMap(map, points, mode)` rewrites the source from the current
 * vertex list — a LineString from 2 points, and a closed Polygon when mode
 * is "area" with 3+ — and `removeLayers(map)` tears all four down.
 */
export function createMeasureController() {
  const sourceId = "measure-points";
  const lineLayerId = "measure-line";
  const fillLayerId = "measure-fill";
  const vertexLayerId = "measure-vertices";

  function addLayers(map: maplibregl.Map) {
    if (map.getSource(sourceId)) return;
    map.addSource(sourceId, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: fillLayerId,
      type: "fill",
      source: sourceId,
      paint: {
        "fill-color": "#00e5ff",
        "fill-opacity": 0.1,
      },
      filter: ["==", ["geometry-type"], "Polygon"],
    });

    map.addLayer({
      id: lineLayerId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#00e5ff",
        "line-width": 2,
        "line-dasharray": [4, 2],
      },
    });

    map.addLayer({
      id: vertexLayerId,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": 5,
        "circle-color": "#00e5ff",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fff",
      },
    });
  }

  function updateMap(map: maplibregl.Map, points: [number, number][], mode: MeasureMode) {
    const source = map.getSource(sourceId);
    if (!source) return;

    const features: GeoJSON.Feature[] = [];

    // Vertex points
    for (let i = 0; i < points.length; i++) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: points[i] },
        properties: { index: i },
      });
    }

    if (points.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: points },
        properties: {},
      });
    }

    if (mode === "area" && points.length >= 3) {
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...points, points[0]]] },
        properties: {},
      });
    }

    source.setData({
      type: "FeatureCollection",
      features,
    });
  }

  function removeLayers(map: maplibregl.Map) {
    try {
      map.removeLayer(fillLayerId);
    } catch {}
    try {
      map.removeLayer(lineLayerId);
    } catch {}
    try {
      map.removeLayer(vertexLayerId);
    } catch {}
    try {
      map.removeSource(sourceId);
    } catch {}
  }

  return { addLayers, updateMap, removeLayers };
}
