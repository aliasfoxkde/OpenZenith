import { removeLayerIfPresent, removeSourceIfPresent } from "./types";
/* ─── Annotation layer — user-drawn points, lines, polygons ─── */

const ANNOTATIONS_KEY = "openzenith-annotations";

/** The three annotation geometries the drawing tool supports. */
export type AnnotationType = "point" | "line" | "polygon";
/**
 * One user-drawn annotation as persisted to localStorage. `coordinates` is an
 * array of [lng, lat] pairs — a single entry for a point, an open polyline
 * for a line (renderAnnotations closes it for polygons), `timestamp` is the
 * creation time in epoch milliseconds.
 */
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

/**
 * Read the user's saved annotations from localStorage under the
 * `openzenith-annotations` key. Returns the stored Annotation array, an empty
 * array when nothing is stored, and an empty array rather than throwing when
 * the value is corrupt or storage is unavailable (private mode, SSR).
 */
export function loadAnnotations(): Annotation[] {
  try {
    const raw = localStorage.getItem(ANNOTATIONS_KEY);
    return raw ? (JSON.parse(raw) as Annotation[]) : [];
  } catch {
    return [];
  }
}

/**
 * Persist the annotation list to localStorage as JSON under
 * `openzenith-annotations`, replacing whatever was there. Throws if storage
 * is unavailable — callers writing from UI event handlers own that failure.
 */
export function saveAnnotations(annotations: Annotation[]): void {
  localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations));
}

/**
 * (Re)draw the annotation set on the map. Any previous annotation layers and
 * the `annotations` source are removed first, so this is a full redraw rather
 * than a diff; with an empty list it stops after that teardown. Points become
 * circles plus a symbol label below them, lines a 2.5px stroke, and polygons
 * a closed ring with a 0.2-opacity fill, all coloured per-annotation from the
 * stored `color` value. Layer creation is wrapped so an in-flight style
 * change degrades to "no annotations drawn" instead of throwing.
 */
export function renderAnnotations(map: maplibregl.Map, annotations: Annotation[]): void {
  // Remove existing layers/sources
  ["annotations-fill", "annotations-line", "annotations-point", "annotations-circle"].forEach((id) => {
    removeLayerIfPresent(map, id);
  });
  removeSourceIfPresent(map, "annotations");

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

/** Remove all four annotation layers and the `annotations` source, ignoring "not found" errors; localStorage is left untouched. */
export function removeAnnotations(map: maplibregl.Map): void {
  ["annotations-point", "annotations-circle", "annotations-line", "annotations-fill"].forEach((id) => {
    removeLayerIfPresent(map, id);
  });
  removeSourceIfPresent(map, "annotations");
}

export { randomColor, uid };
