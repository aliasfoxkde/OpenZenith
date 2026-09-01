/**
 * Supercluster Integration for OpenZenith Globe
 *
 * Provides point aggregation using Supercluster algorithm.
 * Used for clustering conflict events, protests, earthquakes, and other point data.
 *
 * Based on patterns from gods-eye.app which uses Supercluster for:
 * - military-flight-clusters
 * - military-vessel-clusters  
 * - protest-clusters
 * - tech-hq-clusters
 * - datacenter-clusters
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCesium = any;

/** Clustered feature with cluster metadata */
export interface ClusterFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    cluster: boolean;
    cluster_id?: number;
    point_count?: number;
    point_count_abbreviated?: string;
    maxSeverity?: number;
    totalCount?: number;
    category?: string;
    [key: string]: unknown;
  };
}

export interface ClusterOptions {
  radius?: number; // Cluster radius in pixels (default: 60)
  maxZoom?: number; // Max zoom for clustering (default: 14)
  minZoom?: number; // Min zoom for clustering (default: 0)
  minPoints?: number; // Min points to form cluster (default: 2)
  minRadius?: number; // Minimum cluster radius in pixels
  maxRadius?: number; // Maximum cluster radius in pixels
  extent?: number; // Tile extent (default: 512)
  nodeSize?: number; // Node size for index (default: 64)
  log?: boolean; // Enable logging
}

/** Default clustering options */
const DEFAULT_OPTIONS: Required<ClusterOptions> = {
  radius: 60,
  maxZoom: 14,
  minZoom: 0,
  minPoints: 2,
  minRadius: 0,
  maxRadius: 0,
  extent: 512,
  nodeSize: 64,
  log: false,
};

/**
 * Simple Supercluster-like implementation.
 * Batches points into clusters based on zoom level.
 */
export class SimpleClusterIndex {
  private points: ClusterFeature[];
  private options: Required<ClusterOptions>;

  constructor(points: ClusterFeature[] = [], options: ClusterOptions = {}) {
    this.points = points;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Load points into the index.
   */
  load(points: ClusterFeature[]): void {
    this.points = points;
  }

  /**
   * Get clusters for a given bounding box and zoom level.
   */
  getClusters(bounds: [number, number, number, number], zoom: number): ClusterFeature[] {
    const [west, south, east, north] = bounds;
    const { radius, maxZoom, minPoints } = this.options;

    // Filter points in bounds
    const inBounds = this.points.filter((p) => {
      const [lon, lat] = p.geometry.coordinates;
      return lon >= west && lon <= east && lat >= south && lat <= north;
    });

    // If zoom is high enough, don't cluster
    if (zoom >= maxZoom || inBounds.length < minPoints) {
      return inBounds;
    }

    // Calculate grid size based on zoom
    const gridSize = this.calculateGridSize(zoom, radius);

    // Group points into grid cells
    const grid = new Map<string, ClusterFeature[]>();

    for (const point of inBounds) {
      const [lon, lat] = point.geometry.coordinates;
      const gridX = Math.floor((lon - west) / gridSize.x);
      const gridY = Math.floor((lat - south) / gridSize.y);
      const key = `${gridX}:${gridY}`;

      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(point);
    }

    // Create clusters from grid cells
    const result: ClusterFeature[] = [];

    for (const [, cellPoints] of grid) {
      if (cellPoints.length >= minPoints) {
        // Calculate cluster center
        const sumLat = cellPoints.reduce((s, p) => s + p.geometry.coordinates[1], 0);
        const sumLon = cellPoints.reduce((s, p) => s + p.geometry.coordinates[0], 0);
        const count = cellPoints.length;

        // Aggregate properties
        const severities = cellPoints.map((p) => {
          const val = p.properties["severity"] ?? p.properties["magnitude"] ?? 1;
          return typeof val === "number" ? val : 1;
        });
        const maxSeverity = Math.max(...severities);

        result.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [sumLon / count, sumLat / count],
          },
          properties: {
            cluster: true,
            point_count: count,
            point_count_abbreviated: count > 999 ? `${Math.round(count / 1000)}k` : String(count),
            maxSeverity,
            totalCount: count,
            category: ((cellPoints[0].properties as Record<string, unknown>)?.category as string) || "unknown",
          },
        });
      } else {
        // Individual points below cluster threshold
        result.push(...cellPoints);
      }
    }

    return result;
  }

  /**
   * Calculate grid cell size based on zoom and radius.
   */
  private calculateGridSize(zoom: number, radius: number): { x: number; y: number } {
    const baseScale = 1 / Math.pow(2, zoom);
    const gridSizeX = (360 * baseScale * radius) / 256;
    const gridSizeY = (180 * baseScale * radius) / 256;
    return { x: gridSizeX, y: gridSizeY };
  }

  /**
   * Get cluster expansion zoom level.
   */
  getClusterExpansionZoom(clusterId: number): number {
    return Math.min((clusterId % 12) + 2, this.options.maxZoom);
  }

  /**
   * Get leaves (original points) of a cluster.
   */
  getClusterLeaves(clusterId: number, limit = 100, offset = 0): ClusterFeature[] {
    const clusterPoints = this.points.filter((p) => {
      return p.properties.cluster_id === clusterId;
    });

    return clusterPoints.slice(offset, offset + limit);
  }
}

/**
 * Create a cluster index for a given data source.
 */
export function createClusterIndex(features: ClusterFeature[], options?: ClusterOptions): SimpleClusterIndex {
  return new SimpleClusterIndex(features, options);
}

/**
 * Convert Cesium entities to GeoJSON features for clustering.
 */
export function entitiesToGeoFeatures(entities: unknown[], Cesium: AnyCesium): ClusterFeature[] {
  return entities
    .map((entity: unknown) => {
      try {
        const ent = entity as {
          position?: { getValue?: (date: unknown) => unknown } | unknown;
          properties?: Record<string, unknown>;
        };
        let pos = ent.position;
        if (typeof pos === "object" && pos !== null && "getValue" in pos) {
          pos = (pos as { getValue: (d: unknown) => unknown }).getValue(new Date());
        }
        if (!pos || typeof pos !== "object") return null;
        const p = pos as { longitude: number; latitude: number };
        if (typeof p.longitude !== "number") return null;

        const lon = Cesium.Math.toDegrees(p.longitude);
        const lat = Cesium.Math.toDegrees(p.latitude);

        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [lon, lat] as [number, number],
          },
          properties: {
            cluster: false,
            ...ent.properties,
          },
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as ClusterFeature[];
}

/**
 * Apply clusters to Cesium entities.
 */
export function renderClustersOnGlobe(
  viewer: unknown,
  Cesium: AnyCesium,
  clusters: ClusterFeature[],
  clusterOptions: {
    clusterColor?: unknown;
    pointColor?: unknown;
    clusterRadius?: number;
  } = {},
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = viewer as any;
  const { clusterColor, pointColor, clusterRadius = 30 } = clusterOptions;

  const defaultClusterColor = Cesium.Color.ORANGE;
  const defaultPointColor = Cesium.Color.RED;

  for (const feature of clusters) {
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties;

    if (props.cluster) {
      // Render cluster
      const count = props.point_count || 1;
      const size = Math.min(Math.log2(count) * 8 + 15, 60);

      v.entities.add({
        id: `cluster-${props.cluster_id}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 1000),
        ellipsoid: {
          radii: new Cesium.Cartesian3(size * 1000, size * 1000, size * 1000),
          material: (clusterColor || defaultClusterColor).withAlpha(0.4),
          outline: true,
          outlineColor: (clusterColor || defaultClusterColor).withAlpha(0.8),
          outlineWidth: 1,
        },
        label: {
          text: props.point_count_abbreviated || String(count),
          font: "bold 11px 'JetBrains Mono', monospace",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
        },
        properties: { type: "cluster", count, ...props },
      });
    } else {
      // Render individual point
      v.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 500),
        point: {
          pixelSize: 6,
          color: pointColor || defaultPointColor,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
        },
        properties: props,
      });
    }
  }
}
