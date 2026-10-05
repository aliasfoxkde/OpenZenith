/**
 * GPS Jamming Hex Grid Layer
 *
 * Displays hexagonal cells for GPS interference regions, drawn from
 * /api/gps-jamming — a static reference dataset of publicly documented
 * interference zones (see that route's docstring). There is no real-time
 * jamming feed behind this layer; if the route is unreachable the layer
 * renders nothing and reports the failure rather than inventing data.
 */

import { isAbort } from "../data-fetchers";
import { warnLayerError } from "@/lib/diagnostics";
import type { DataStatus } from "../types";
import { createRetryGuard } from "../helpers";
import { pushLayerTimer, type LayerTimersRef } from "./timers";

/** GPS Jamming intensity levels */
export interface GpsJammingHex {
  lat: number;
  lon: number;
  resolution: number;
  intensity: number; // 0-1 scale
  source: string;
  timestamp: string;
}

/** H3 Resolution → approximate edge length in meters */
const H3_RESOLUTION_EDGES: Record<number, number> = {
  4: 266_725, // ~266km
  5: 73_907, // ~74km
  6: 17_316, // ~17km
  7: 4_052, // ~4km
  8: 949, // ~950m
  9: 222, // ~222m
};

/** Color gradient for intensity (red = severe, orange = moderate, yellow = low) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party Cesium namespace
function intensityColor(intensity: number, Cesium: any): any {
  if (intensity >= 0.5) return Cesium.Color.ORANGE;
  if (intensity >= 0.3) return Cesium.Color.YELLOW;
  return Cesium.Color.GREEN;
}

/**
 * Generate hexagon vertices around a center point.
 * Returns array of [lon, lat] pairs for 6 vertices.
 */
function hexagonVertices(centerLon: number, centerLat: number, edgeLenMeters: number): number[][] {
  const vertices: number[][] = [];
  const angularDist = edgeLenMeters / 6371000; // Convert meters to radians
  const degPerRad = 180 / Math.PI;
  const latRad = centerLat / degPerRad;

  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // Start at top
    const latOffset = angularDist * Math.cos(angle) * degPerRad;
    const lonOffset = (angularDist / Math.cos(latRad)) * Math.sin(angle) * degPerRad;
    vertices.push([centerLon + lonOffset, centerLat + latOffset]);
  }
  vertices.push(vertices[0]); // Close the polygon
  return vertices;
}

/**
 * Fetch the GPS interference reference dataset. The route is the single
 * source of truth — no client-side fallback data: a failed fetch surfaces
 * as a layer error instead of silently rendering stale or invented hexes.
 */
async function fetchGpsJammingData(signal?: AbortSignal): Promise<GpsJammingHex[]> {
  const response = await fetch("/api/gps-jamming", { signal });
  if (!response.ok) {
    throw new Error(`gps-jamming route returned ${response.status}`);
  }
  const data = (await response.json()) as { hexes?: GpsJammingHex[] };
  return data.hexes || [];
}

/**
 * Load GPS jamming hex grid on the globe.
 */
export function loadGpsJamming(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party Cesium.Viewer
  viewer: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party Cesium namespace
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  intervalsRef: LayerTimersRef,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party Cesium entity record
  _entitiesRef: React.RefObject<Record<string, any>>,
  stateLayers: { gpsJamming: boolean },
  signal?: AbortSignal,
) {
  updateStatus("gpsJamming", { error: null });
  const retry = createRetryGuard();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party Cesium entity array
  let hexEntities: any[] = [];

  const renderHexGrid = (hexes: GpsJammingHex[]) => {
    // Remove existing hexes
    hexEntities.forEach((id) => {
      const entity = viewer.entities.getById(id);
      if (entity) viewer.entities.remove(entity);
    });
    hexEntities = [];

    hexes.forEach((hex, idx) => {
      const edgeLen = H3_RESOLUTION_EDGES[hex.resolution] || 17316;
      const vertices = hexagonVertices(hex.lon, hex.lat, edgeLen);
      const color = intensityColor(hex.intensity, Cesium);
      const entityId = `gps-jam-hex-${idx}`;

      // Create hexagon polygon
      viewer.entities.add({
        id: entityId,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(vertices.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))),
          material: color.withAlpha(0.3 * hex.intensity + 0.1),
          outline: true,
          outlineColor: color.withAlpha(0.6),
          outlineWidth: 1,
          perPositionHeight: true,
        },
        properties: {
          type: "gps-jamming-hex",
          intensity: hex.intensity,
          source: hex.source,
        },
      });
      hexEntities.push(entityId);

      // Add intensity label for severe interference
      if (hex.intensity >= 0.7) {
        viewer.entities.add({
          id: `gps-jam-label-${idx}`,
          position: Cesium.Cartesian3.fromDegrees(hex.lon, hex.lat, 1000),
          label: {
            text: `⚠ JAM ${Math.round(hex.intensity * 100)}%`,
            font: "bold 10px 'JetBrains Mono', monospace",
            fillColor: Cesium.Color.RED,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e5, 0.0),
          },
          properties: { type: "gps-jamming-label" },
        });
        hexEntities.push(`gps-jam-label-${idx}`);
      }
    });
  };

  const doLoad = async () => {
    try {
      const hexes = await fetchGpsJammingData(signal);
      renderHexGrid(hexes);
      updateStatus("gpsJamming", {
        lastUpdate: Date.now(),
        count: hexes.length,
        error: null,
      });
      retry.recordSuccess();
    } catch (err) {
      if (isAbort(err)) return; // teardown, not a failure
      warnLayerError("gpsJamming", err, "entity build");
      retry.recordFailure();
      updateStatus("gpsJamming", {
        error: retry.shouldRetry ? `Retrying...` : "GPS Jamming data unavailable",
      });
    }
  };

  void doLoad();

  const refresh = async () => {
    if (!stateLayers.gpsJamming) return;
    try {
      const hexes = await fetchGpsJammingData(signal);
      renderHexGrid(hexes);
      updateStatus("gpsJamming", { lastUpdate: Date.now(), count: hexes.length });
    } catch (err) {
      if (isAbort(err)) return; // teardown, not a failure
      warnLayerError("gpsJamming", err, "refresh");
    }
  };

  // Refresh interval (GPS jamming zones don't change often)
  const iv = setInterval(() => {
    void refresh();
  }, 600000); // 10 minutes

  pushLayerTimer(intervalsRef, "gpsJamming", iv);
}
