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
  for (let i = 1; i < coords.length; i++) {
    total += haversineDistance(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
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
    const lat1 = toRad(coords[i][1]);
    const lat2 = toRad(coords[j][1]);
    const dLon = toRad(coords[j][0] - coords[i][0]);
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

export type MeasureMode = "none" | "distance" | "area";

export interface MeasureState {
  mode: MeasureMode;
  points: [number, number][]; // [lon, lat]
}

export function createMeasureController() {
  const sourceId = "measure-points";
  const lineLayerId = "measure-line";
  const fillLayerId = "measure-fill";
  const vertexLayerId = "measure-vertices";

  function addLayers(map: any) {
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

  function updateMap(map: any, points: [number, number][], mode: MeasureMode) {
    if (!map.getSource(sourceId)) return;

    const features: any[] = [];

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

    (map.getSource(sourceId) as any).setData({
      type: "FeatureCollection",
      features,
    });
  }

  function removeLayers(map: any) {
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
