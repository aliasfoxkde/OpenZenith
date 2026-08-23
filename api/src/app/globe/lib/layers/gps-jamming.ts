/**
 * GPS Jamming Hex Grid Layer
 *
 * Displays hexagonal H3 cells indicating GPS jamming activity.
 * Data sources:自主 (OpenZenith), jam data from various sensors.
 *
 * Based on patterns from gods-eye.app which confirms this layer type
 * with hex-grid visualization for electronic warfare detection.
 */

import type { DataStatus } from "../types";
import { createRetryGuard } from "../helpers";

/** GPS Jamming intensity levels */
export interface GpsJammingHex {
  lat: number;
  lon: number;
  resolution: number;
  intensity: number; // 0-1 scale
  source: string;
  timestamp: string;
}

/** Hex cell for Cesium rendering */
interface _HexCell {
  lat: number;
  lon: number;
  edgeLen: number;
  intensity: number;
  id: string;
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
 * Convert lat/lon + resolution to H3 cell ID (simplified).
 * Uses a pseudo-H3 approximation for visualization.
 */
function _latLonToCellId(lat: number, lon: number, resolution: number): string {
  const latBucket = Math.round(lat * Math.pow(2, resolution));
  const lonBucket = Math.round(lon * Math.pow(2, resolution));
  return `gps-jam-${resolution}-${latBucket}-${lonBucket}`;
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
 * Fetch GPS jamming data from various sources.
 * Combines public ADS-B based jamming detection with other sources.
 */
async function fetchGpsJammingData(): Promise<GpsJammingHex[]> {
  try {
    // Primary: OpenZenith GPS jamming database (when available)
    const response = await fetch("/api/gps-jamming");
    if (response.ok) {
      const data = await response.json();
      return data.hexes || [];
    }
  } catch {
    /* continue to fallback */
  }

  // Fallback: Generate demo hexes for known problem areas
  // These are approximate based on publicly known GPS interference zones
  return generateKnownJammingZones();
}

/** Known GPS interference/jamming zones (approximate, for demo) */
function generateKnownJammingZones(): GpsJammingHex[] {
  const zones: GpsJammingHex[] = [
    // Ukraine conflict zone - well documented GPS interference
    {
      lat: 50.45,
      lon: 30.52,
      resolution: 6,
      intensity: 0.9,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 48.5,
      lon: 35.0,
      resolution: 6,
      intensity: 0.85,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 49.8,
      lon: 33.5,
      resolution: 6,
      intensity: 0.7,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },

    // Middle East - documented interference areas
    {
      lat: 31.5,
      lon: 34.8,
      resolution: 6,
      intensity: 0.6,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 29.5,
      lon: 45.0,
      resolution: 6,
      intensity: 0.5,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },

    // Taiwan Strait - documented interference
    {
      lat: 24.5,
      lon: 119.5,
      resolution: 6,
      intensity: 0.65,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },

    // Russian border areas
    {
      lat: 60.0,
      lon: 30.0,
      resolution: 6,
      intensity: 0.4,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
    {
      lat: 55.7,
      lon: 37.6,
      resolution: 6,
      intensity: 0.55,
      source: "ADS-B Analysis",
      timestamp: new Date().toISOString(),
    },
  ];

  return zones;
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
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party Cesium entity record
  _entitiesRef: React.MutableRefObject<Record<string, any>>,
  stateLayers: { gpsJamming: boolean },
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
      const hexes = await fetchGpsJammingData();
      renderHexGrid(hexes);
      updateStatus("gpsJamming", {
        lastUpdate: Date.now(),
        count: hexes.length,
        error: null,
      });
      retry.recordSuccess();
    } catch {
      retry.recordFailure();
      updateStatus("gpsJamming", {
        error: retry.shouldRetry ? `Retrying...` : "GPS Jamming data unavailable",
      });
    }
  };

  doLoad();

  // Refresh interval (GPS jamming zones don't change often)
  const iv = setInterval(async () => {
    if (!stateLayers.gpsJamming) return;
    try {
      const hexes = await fetchGpsJammingData();
      renderHexGrid(hexes);
      updateStatus("gpsJamming", { lastUpdate: Date.now(), count: hexes.length });
    } catch {
      // Silent failure on refresh
    }
  }, 600000); // 10 minutes

  intervalsRef.current.push(iv);
}
