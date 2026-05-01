/**
 * Satellite Imagery Footprints Layer
 * 
 * Displays satellite coverage footprints on the globe.
 * Shows recent imagery acquisition areas for various satellite constellations.
 * 
 * Based on patterns from gods-eye.app which includes satellite footprint visualization.
 */

import type { DataStatus } from "../types";

/** Satellite imagery source definitions */
interface SatelliteImager {
  id: string;
  name: string;
  constellation: string;
  resolution: number;  // meters
  revisitHours: number;
  coverage: "global" | "regional" | "polar";
  color: string;
}

/** Available satellite imagery sources */
const IMAGERY_SOURCES: SatelliteImager[] = [
  {
    id: "sentinel-2",
    name: "Sentinel-2",
    constellation: "Copernicus",
    resolution: 10,
    revisitHours: 5,
    coverage: "global",
    color: "#00ff00",
  },
  {
    id: "landsat-8",
    name: "Landsat 8/9",
    constellation: "USGS/NASA",
    resolution: 30,
    revisitHours: 16,
    coverage: "global",
    color: "#00bfff",
  },
  {
    id: "planet-sky",
    name: "PlanetScope",
    constellation: "Planet Labs",
    resolution: 3,
    revisitHours: 1,
    coverage: "regional",
    color: "#ff8800",
  },
  {
    id: "virr",
    name: "VIIRS",
    constellation: "NASA/NOAA",
    resolution: 750,
    revisitHours: 12,
    coverage: "global",
    color: "#ffff00",
  },
  {
    id: "modis",
    name: "MODIS",
    constellation: "NASA",
    resolution: 250,
    revisitHours: 2,
    coverage: "global",
    color: "#ff00ff",
  },
];

/** Simulated footprint data */
interface ImageryFootprint {
  id: string;
  satellite: string;
  lat: number;
  lon: number;
  width: number;   // km
  height: number;  // km
  timestamp: string;
  cloudCover: number;
}

/** Generate demo footprints for visualization */
function generateDemoFootprints(satellite: SatelliteImager, count: number): ImageryFootprint[] {
  const footprints: ImageryFootprint[] = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    // Generate realistic-looking footprints distributed globally
    const lat = (Math.random() - 0.5) * 140;  // -70 to 70 degrees
    const lon = (Math.random() - 0.5) * 340;  // -170 to 170 degrees
    
    // Adjust footprint size based on satellite resolution
    const baseSize = satellite.resolution * 1000;  // meters to km
    const width = baseSize * (5 + Math.random() * 10);
    const height = baseSize * (5 + Math.random() * 10);
    
    // Recent timestamps within revisit period
    const hoursAgo = Math.random() * satellite.revisitHours;
    const timestamp = new Date(now.getTime() - hoursAgo * 3600000).toISOString();
    
    footprints.push({
      id: `${satellite.id}-${i}`,
      satellite: satellite.name,
      lat,
      lon,
      width,
      height,
      timestamp,
      cloudCover: Math.random() * 0.8,  // 0-80% cloud cover
    });
  }
  
  return footprints;
}

/**
 * Load satellite imagery footprints on the globe.
 */
export function loadImageryFootprints(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  removeEntities: (prefix: string) => void,
  _intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  _entitiesRef: React.MutableRefObject<Record<string, any>>,
  stateLayers: { imageryFootprints: boolean },
) {
  updateStatus("imageryFootprints", { error: null });
  
  if (!stateLayers.imageryFootprints) {
    removeEntities("sat-footprint");
    return;
  }

  let totalCount = 0;
  
  for (const source of IMAGERY_SOURCES) {
    // Generate demo footprints
    const footprints = generateDemoFootprints(source, 50);
    totalCount += footprints.length;
    
    const color = Cesium.Color.fromCssColorString(source.color);
    
    for (const fp of footprints) {
      // Create footprint rectangle
      const halfW = fp.width / 2 / 111;  // km to degrees (roughly)
      const halfH = fp.height / 2 / 111;
      
      viewer.entities.add({
        id: `sat-footprint-${fp.id}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy([
            Cesium.Cartesian3.fromDegrees(fp.lon - halfW, fp.lat - halfH),
            Cesium.Cartesian3.fromDegrees(fp.lon + halfW, fp.lat - halfH),
            Cesium.Cartesian3.fromDegrees(fp.lon + halfW, fp.lat + halfH),
            Cesium.Cartesian3.fromDegrees(fp.lon - halfW, fp.lat + halfH),
          ]),
          material: color.withAlpha(0.2),
          outline: true,
          outlineColor: color.withAlpha(0.5),
          outlineWidth: 1,
          perPositionHeight: false,
        },
        properties: {
          type: "sat-imagery-footprint",
          satellite: fp.satellite,
          timestamp: fp.timestamp,
          cloudCover: fp.cloudCover,
        },
      });
      
      // Add label for high-resolution satellites
      if (source.resolution <= 10) {
        viewer.entities.add({
          id: `sat-footprint-label-${fp.id}`,
          position: Cesium.Cartesian3.fromDegrees(fp.lon, fp.lat, 0),
          label: {
            text: source.name,
            font: "9px 'JetBrains Mono', monospace",
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, 0),
            scaleByDistance: new Cesium.NearFarScalar(1e6, 0.8, 5e6, 0.0),
          },
          properties: { type: "sat-imagery-label" },
        });
      }
    }
  }

  // Add legend entry for imagery sources
  viewer.entities.add({
    id: "sat-imagery-legend",
    label: {
      text: "🛰️ Satellite Imagery Footprints",
      font: "bold 12px 'JetBrains Mono', monospace",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.TOP,
      pixelOffset: new Cesium.Cartesian2(10, 10),
    },
    properties: { type: "sat-imagery-legend" },
  });

  updateStatus("imageryFootprints", { 
    lastUpdate: Date.now(), 
    count: totalCount 
  });
}

/**
 * Get available satellite imagery sources.
 */
export function getImagerySources(): SatelliteImager[] {
  return IMAGERY_SOURCES;
}
