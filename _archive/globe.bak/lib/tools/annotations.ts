/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Annotation manager — draw markers, lines, polygons, and text labels on the globe.
 */

export type AnnotationType = "marker" | "line" | "polygon" | "text";

interface Annotation {
  id: string;
  type: AnnotationType;
  points: { lng: number; lat: number }[];
  label?: string;
  entities: any[];
}

const COLORS: Record<AnnotationType, string> = {
  marker: "#ff4444",
  line: "#ff8800",
  polygon: "#aa44ff",
  text: "#44aaff",
};

export interface AnnotationManager {
  mode: AnnotationType | null;
  points: { lng: number; lat: number }[];
  annotations: Annotation[];
  setMode: (mode: AnnotationType | null) => void;
  handleClick: (lng: number, lat: number) => void;
  finish: () => void;
  clearAll: () => void;
  setLabel: (annotationId: string, text: string) => void;
  exportGeoJSON: () => string;
}

export function createAnnotationManager(viewer: any, Cesium: any): AnnotationManager {
  const annotations: Annotation[] = [];
  let mode: AnnotationType | null = null;
  let points: { lng: number; lat: number }[] = [];

  const removeAnnotationEntities = (ann: Annotation) => {
    ann.entities.forEach((e) => {
      try {
        viewer.entities.remove(e);
      } catch {
        /* already removed */
      }
    });
  };

  const finish = () => {
    if (!mode || points.length === 0) return;

    const color = Cesium.Color.fromCssColorString(COLORS[mode]);
    const id = `${mode}-${Date.now()}`;
    const entities: any[] = [];

    if (mode === "marker") {
      const p = points[0];
      const entity = viewer.entities.add({
        id: `${id}-pt`,
        position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat),
        point: {
          pixelSize: 10,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: annotations.length === 0 ? "" : "", // label set separately
          font: "11px 'JetBrains Mono', monospace",
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
          backgroundPadding: new Cesium.Cartesian2(4, 2),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: "annotation", annotationType: "marker" },
      });
      entities.push(entity);
    } else if (mode === "line" && points.length >= 2) {
      const positions = points.flatMap((p) => [p.lng, p.lat]);
      const line = viewer.entities.add({
        id: `${id}-line`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(positions),
          width: 3,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color,
          }),
          clampToGround: true,
        },
        properties: { type: "annotation", annotationType: "line" },
      });
      entities.push(line);
    } else if (mode === "polygon" && points.length >= 3) {
      const positions = points.flatMap((p) => [p.lng, p.lat]);
      const polygon = viewer.entities.add({
        id: `${id}-poly`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(positions)),
          material: color.withAlpha(0.2),
          outline: true,
          outlineColor: color,
          outlineWidth: 2,
          height: 0,
          classificationType: Cesium.ClassificationType.BOTH,
        },
        properties: { type: "annotation", annotationType: "polygon" },
      });
      entities.push(polygon);
    } else if (mode === "text") {
      const p = points[0];
      const entity = viewer.entities.add({
        id: `${id}-text`,
        position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat),
        label: {
          text: "",
          font: "12px 'JetBrains Mono', monospace",
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.BLACK.withAlpha(0.7),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { type: "annotation", annotationType: "text" },
      });
      entities.push(entity);
    }

    annotations.push({ id, type: mode, points: [...points], entities });
    mode = null;
    points = [];
  };

  const handleClick = (lng: number, lat: number) => {
    if (!mode) return;
    points.push({ lng, lat });
  };

  const setMode = (newMode: AnnotationType | null) => {
    if (newMode !== mode) {
      // Finish any in-progress annotation
      if (mode && points.length > 0) finish();
      mode = newMode;
      points = [];
    }
  };

  const clearAll = () => {
    annotations.forEach(removeAnnotationEntities);
    annotations.length = 0;
    mode = null;
    points = [];
  };

  const setLabel = (annotationId: string, text: string) => {
    const ann = annotations.find((a) => a.id === annotationId);
    if (ann) {
      const labelEntity = ann.entities.find((e) => e.label);
      if (labelEntity) labelEntity.label = text;
      ann.label = text;
    }
  };

  const exportGeoJSON = () => {
    const features = annotations.map((ann) => ({
      type: "Feature" as const,
      geometry:
        ann.type === "marker"
          ? { type: "Point" as const, coordinates: [ann.points[0].lng, ann.points[0].lat] }
          : ann.type === "line"
            ? { type: "LineString" as const, coordinates: ann.points.map((p) => [p.lng, p.lat]) }
            : {
                type: "Polygon" as const,
                coordinates: [[...ann.points.map((p) => [p.lng, p.lat]), ann.points[0]?.lng, ann.points[0]?.lat]],
              },
      properties: { annotationType: ann.type, label: ann.label },
    }));
    return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
  };

  return { mode, points, annotations, setMode, handleClick, finish, clearAll, setLabel, exportGeoJSON };
}
