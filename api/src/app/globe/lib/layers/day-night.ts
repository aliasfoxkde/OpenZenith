/**
 * Day/Night Terminator Layer
 *
 * Displays the terminator line between day and night sides of Earth.
 * Uses solar position calculation to determine lit/unlit portions.
 *
 * Based on patterns from gods-eye.app which includes:
 * - day-night-layer toggle
 * - terminator overlay visualization
 * - shadow/shading effects
 */

import type { DataStatus } from "../types";

/** Sun position data */
interface _SunPosition {
  declination: number; // Solar declination in radians
  rightAscension: number;
  hourAngle: number;
}

/**
 * Calculate solar declination based on day of year.
 * Approximation accurate to ~0.5 degrees.
 */
function solarDeclination(dayOfYear: number): number {
  // Simplified calculation (no equation of time correction)
  return -23.45 * Math.cos(((360 / 365) * (dayOfYear + 10) * Math.PI) / 180);
}

/**
 * Calculate the terminator points for a given solar declination.
 * Returns array of [longitude, latitude] points along the day/night boundary.
 */
function calculateTerminatorPoints(declination: number, numPoints = 360): number[][] {
  const points: number[][] = [];
  const decRad = (declination * Math.PI) / 180;

  for (let i = 0; i <= numPoints; i++) {
    const longitude = (i / numPoints) * 360 - 180;
    const _lonRad = (longitude * Math.PI) / 180;

    // Latitude where terminator crosses this longitude
    // tan(lat) = -cos(H) / tan(dec) where H is hour angle
    // At current time, hour angle = longitude of subsolar point
    const subsolarLon = 0; // Would be calculated from current time
    const hourAngle = ((longitude - subsolarLon) * Math.PI) / 180;

    let lat: number;
    if (Math.abs(declination) >= 89.5) {
      // Near equinox, terminator is almost straight
      lat = 0;
    } else {
      // General case: latitude of illumination boundary
      const tanLat = -Math.cos(hourAngle) / Math.tan(decRad);
      lat = (Math.atan(tanLat) * 180) / Math.PI;
    }

    points.push([longitude, lat]);
  }

  return points;
}

/**
 * Calculate shadow polygons for night side.
 * Returns a polygon covering the dark portion of Earth.
 */
function calculateNightShadowPolygon(declination: number): number[][] {
  const points: number[][] = [];
  const decRad = (declination * Math.PI) / 180;

  // Solar longitude (subsolar point longitude)
  const now = new Date();
  const hourAngle = (now.getUTCHours() + now.getUTCMinutes() / 60) * 15 - 180;

  // Calculate points along the night boundary
  const numPoints = 180;
  for (let i = 0; i <= numPoints; i++) {
    const lon = (i / numPoints) * 360 - 180;
    const _lonRad = (lon * Math.PI) / 180;
    const hourAngleRad = ((lon - hourAngle) * Math.PI) / 180;

    let lat: number;
    if (Math.abs(declination) >= 89.5) {
      lat = declination > 0 ? -90 : 90;
    } else {
      const tanLat = -Math.cos(hourAngleRad) / Math.tan(decRad);
      lat = (Math.atan(tanLat) * 180) / Math.PI;
    }

    points.push([lon, lat]);
  }

  // Close the polygon
  points.push(points[0]);
  return points;
}

/**
 * Load day/night terminator overlay.
 */
export function loadDayNightTerminator(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  _intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  _entitiesRef: React.MutableRefObject<Record<string, any>>,
  stateLayers: { dayNight: boolean },
) {
  updateStatus("dayNight", { error: null });

  if (!stateLayers.dayNight) {
    removeEntities("day-night");
    return;
  }

  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const declination = solarDeclination(dayOfYear);

  // Create night shadow polygon
  const nightPolygonPoints = calculateNightShadowPolygon(declination);

  // Add night side semi-transparent overlay
  viewer.entities.add({
    id: "day-night-shadow",
    polygon: {
      hierarchy: new Cesium.PolygonHierarchy(
        nightPolygonPoints.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
      ),
      material: Cesium.Color.BLACK.withAlpha(0.35),
      outline: false,
      perPositionHeight: false,
    },
    properties: { type: "day-night-shadow" },
  });

  // Add terminator line
  const terminatorPoints = calculateTerminatorPoints(declination);

  viewer.entities.add({
    id: "day-night-terminator",
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(terminatorPoints.flatMap(([lon, lat]) => [lon, lat])),
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({
        dashPattern: 0xffff00,
        color: Cesium.Color.YELLOW.withAlpha(0.8),
      }),
      clampToGround: false,
    },
    properties: { type: "day-night-terminator" },
  });

  // Add dawn/dusk labels
  viewer.entities.add({
    id: "day-night-label-dawn",
    position: Cesium.Cartesian3.fromDegrees(-90, 0, 0),
    label: {
      text: "☀️ DAWN",
      font: "bold 12px 'JetBrains Mono', monospace",
      fillColor: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 1e7, 0.5),
    },
    properties: { type: "day-night-label" },
  });

  viewer.entities.add({
    id: "day-night-label-dusk",
    position: Cesium.Cartesian3.fromDegrees(90, 0, 0),
    label: {
      text: "🌙 DUSK",
      font: "bold 12px 'JetBrains Mono', monospace",
      fillColor: Cesium.Color.LIGHTBLUE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 1e7, 0.5),
    },
    properties: { type: "day-night-label" },
  });

  updateStatus("dayNight", { lastUpdate: Date.now(), count: 1 });
}

/**
 * Toggle day/night terminator on/off.
 */
export function toggleDayNightTerminator(
  viewer: any,
  Cesium: any,
  enabled: boolean,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
) {
  if (!enabled) {
    removeEntities("day-night");
    updateStatus("dayNight", { lastUpdate: null, count: 0 });
    return;
  }

  loadDayNightTerminator(
    viewer,
    Cesium,
    updateStatus,
    removeEntities,
    { current: [] },
    { current: {} },
    { dayNight: true },
  );
}
