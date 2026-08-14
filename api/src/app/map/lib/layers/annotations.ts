import type { LayerHandle } from "./types";

/* ─── Annotation layer — user-drawn points, lines, polygons ─── */

const ANNOTATIONS_KEY = "openzenith-annotations";

export type AnnotationType = "point" | "line" | "polygon";
export type Annotation = {
  id: string;
  type: AnnotationType;
  coordinates: number[][]; // [lng, lat][]
  color: string;
  name: string;
  timestamp: number;
};

const COLORS = ["#00ff88", "#ff6b35", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function loadAnnotations(): Annotation[] {
  try {
    const raw = localStorage.getItem(ANNOTATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAnnotations(annotations: Annotation[]): void {
  localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations));
}

export function renderAnnotations(map: maplibregl.Map, annotations: Annotation[]): void {
  // Remove existing layers/sources
  ["annotations-fill", "annotations-line", "annotations-point", "annotations-circle"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("annotations");
  } catch {}

  if (annotations.length === 0) return;

  const features: GeoJSON.Feature[] = annotations.map((a) => {
    if (a.type === "point") {
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: a.coordinates[0] },
        properties: { id: a.id, color: a.color, name: a.name, annotationType: "point" },
      };
    }
    if (a.type === "line") {
      return {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: a.coordinates as [number, number][] },
        properties: { id: a.id, color: a.color, name: a.name, annotationType: "line" },
      };
    }
    // polygon
    const ring = [...a.coordinates, a.coordinates[0]] as [number, number][];
    return {
      type: "Feature" as const,
      geometry: { type: "Polygon" as const, coordinates: [ring] },
      properties: { id: a.id, color: a.color, name: a.name, annotationType: "polygon" },
    };
  });

  const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

  try {
    map.addSource("annotations", { type: "geojson", data: geojson });

    // Polygon fill
    map.addLayer({
      id: "annotations-fill",
      type: "fill",
      source: "annotations",
      filter: ["==", ["get", "annotationType"], "polygon"],
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": 0.2,
      },
    });

    // Line + polygon outline
    map.addLayer({
      id: "annotations-line",
      type: "line",
      source: "annotations",
      filter: ["in", ["get", "annotationType"], ["literal", ["line", "polygon"]]],
      paint: {
        "line-color": ["get", "color"],
        "line-width": 2.5,
        "line-opacity": 0.8,
      },
    });

    // Point markers
    map.addLayer({
      id: "annotations-circle",
      type: "circle",
      source: "annotations",
      filter: ["==", ["get", "annotationType"], "point"],
      paint: {
        "circle-radius": 6,
        "circle-color": ["get", "color"],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    // Point labels
    map.addLayer({
      id: "annotations-point",
      type: "symbol",
      source: "annotations",
      filter: ["==", ["get", "annotationType"], "point"],
      layout: {
        "text-field": ["get", "name"],
        "text-offset": [0, 1.5],
        "text-size": 11,
        "text-anchor": "top",
      },
      paint: {
        "text-color": ["get", "color"],
        "text-halo-color": "rgba(0,0,0,0.8)",
        "text-halo-width": 1.5,
      },
    });
  } catch {
    /* style may have changed */
  }
}

export function removeAnnotations(map: maplibregl.Map): void {
  ["annotations-point", "annotations-circle", "annotations-line", "annotations-fill"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("annotations");
  } catch {}
}

export { randomColor, uid };
