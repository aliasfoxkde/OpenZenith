/**
 * Globe Tools — Interactive measurement and drawing tools.
 *
 * Provides point-to-point distance measurement and area measurement
 * using CesiumJS entities. Tools are activated via the toolbar.
 */

import { haversineDistance, formatDistance, formatArea, polylineLength, polygonArea } from "./measure";

export type ToolMode = "none" | "measure-distance" | "measure-area" | "elevation-profile";

interface ToolState {
  mode: ToolMode;
  points: { lng: number; lat: number }[];
  tempEntity: any;
  resultEntities: any[];
}

export function createToolManager(viewer: any, Cesium: any) {
  const state: ToolState = {
    mode: "none",
    points: [],
    tempEntity: null,
    resultEntities: [],
  };

  const clear = () => {
    state.points = [];
    if (state.tempEntity) {
      viewer.entities.remove(state.tempEntity);
      state.tempEntity = null;
    }
    state.resultEntities.forEach((e) => viewer.entities.remove(e));
    state.resultEntities = [];
  };

  const handleClick = (lng: number, lat: number) => {
    if (state.mode === "none") return;

    state.points.push({ lng, lat });

    if (state.mode === "measure-distance") {
      updateDistanceMeasure();
    } else if (state.mode === "measure-area") {
      updateAreaMeasure();
    }
  };

  const updateDistanceMeasure = () => {
    // Remove old entities
    state.resultEntities.forEach((e) => viewer.entities.remove(e));
    state.resultEntities = [];
    if (state.tempEntity) {
      viewer.entities.remove(state.tempEntity);
      state.tempEntity = null;
    }

    const pts = state.points;
    if (pts.length < 1) return;

    // Draw line between points
    if (pts.length >= 2) {
      const positions = pts.flatMap((p) => [p.lng, p.lat]);
      const line = viewer.entities.add({
        id: "tool-measure-line",
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(positions),
          width: 3,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Cesium.Color.fromCssColorString("#00ff88"),
          }),
          clampToGround: true,
        },
        properties: { type: "tool-measure" },
      });
      state.resultEntities.push(line);
    }

    // Draw point markers
    for (const pt of pts) {
      const marker = viewer.entities.add({
        id: `tool-pt-${pt.lng.toFixed(4)}-${pt.lat.toFixed(4)}`,
        position: Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat),
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString("#00ff88"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: "tool-measure" },
      });
      state.resultEntities.push(marker);
    }

    // Calculate total distance
    const coords: number[][] = pts.map((p) => [p.lng, p.lat]);
    const totalDist = polylineLength(coords);

    // Label at last point
    if (pts.length >= 2) {
      const last = pts[pts.length - 1];
      const label = viewer.entities.add({
        id: "tool-measure-label",
        position: Cesium.Cartesian3.fromDegrees(last.lng, last.lat),
        label: {
          text: formatDistance(totalDist),
          font: "bold 13px 'JetBrains Mono', monospace",
          fillColor: Cesium.Color.fromCssColorString("#00ff88"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: "tool-measure" },
      });
      state.resultEntities.push(label);
    }

    // Segment distances
    for (let i = 1; i < pts.length; i++) {
      const segDist = haversineDistance(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
      const mid = {
        lng: (pts[i - 1].lng + pts[i].lng) / 2,
        lat: (pts[i - 1].lat + pts[i].lat) / 2,
      };
      const segLabel = viewer.entities.add({
        id: `tool-seg-${i}`,
        position: Cesium.Cartesian3.fromDegrees(mid.lng, mid.lat),
        label: {
          text: formatDistance(segDist),
          font: "10px 'JetBrains Mono', monospace",
          fillColor: Cesium.Color.WHITE.withAlpha(0.7),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.5),
          backgroundPadding: new Cesium.Cartesian2(4, 2),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: "tool-measure" },
      });
      state.resultEntities.push(segLabel);
    }
  };

  const updateAreaMeasure = () => {
    state.resultEntities.forEach((e) => viewer.entities.remove(e));
    state.resultEntities = [];

    const pts = state.points;
    if (pts.length < 3) {
      // Still drawing — show points and partial polygon
      for (const pt of pts) {
        const marker = viewer.entities.add({
          id: `tool-area-pt-${pt.lng.toFixed(4)}`,
          position: Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat),
          point: {
            pixelSize: 8,
            color: Cesium.Color.fromCssColorString("#ff8800"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: { type: "tool-measure" },
        });
        state.resultEntities.push(marker);
      }
      return;
    }

    // Draw filled polygon
    const positions = pts.flatMap((p) => [p.lng, p.lat]);
    const polygon = viewer.entities.add({
      id: "tool-area-polygon",
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(positions)),
        material: Cesium.Color.fromCssColorString("#ff8800").withAlpha(0.2),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#ff8800"),
        outlineWidth: 2,
        height: 0,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      properties: { type: "tool-measure" },
    });
    state.resultEntities.push(polygon);

    // Vertex markers
    for (const pt of pts) {
      const marker = viewer.entities.add({
        id: `tool-area-vertex-${pt.lng.toFixed(4)}`,
        position: Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat),
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString("#ff8800"),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: "tool-measure" },
      });
      state.resultEntities.push(marker);
    }

    // Calculate area
    const areaCoords: number[][] = pts.map((p) => [p.lng, p.lat]);
    const area = polygonArea(areaCoords);

    // Perimeter
    const perimeter = polylineLength(areaCoords);

    // Label at centroid
    const centerLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    const centerLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const label = viewer.entities.add({
      id: "tool-area-label",
      position: Cesium.Cartesian3.fromDegrees(centerLng, centerLat),
      label: {
        text: `${formatArea(area)}\nPerimeter: ${formatDistance(perimeter)}`,
        font: "bold 12px 'JetBrains Mono', monospace",
        fillColor: Cesium.Color.fromCssColorString("#ff8800"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
        backgroundPadding: new Cesium.Cartesian2(8, 6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { type: "tool-measure" },
    });
    state.resultEntities.push(label);
  };

  const setMode = (mode: ToolMode) => {
    clear();
    state.mode = mode;
  };

  return { state, handleClick, clear, setMode };
}
