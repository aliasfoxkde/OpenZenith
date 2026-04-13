/** MapLibre style expression — nested arrays of strings, numbers, and sub-expressions */
type MapLibreExpression = (string | number | MapLibreExpression)[];

/** Color ramp definitions */
export const COLOR_RAMPS = {
  sequential: [
    [0, "#f0f9e8"],
    [0.25, "#bae4bc"],
    [0.5, "#7bccc4"],
    [0.75, "#43a2ca"],
    [1, "#0868ac"],
  ] as [number, string][],
  diverging: [
    [0, "#d73027"],
    [0.25, "#fc8d59"],
    [0.5, "#fee08b"],
    [0.75, "#91bfdb"],
    [1, "#4575b4"],
  ] as [number, string][],
  categorical: ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"],
} as const;

/** Extract numeric property values from features */
function getPropertyRange(data: GeoJSON.FeatureCollection, property: string): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let found = false;
  for (const f of data.features) {
    const v = f.properties?.[property];
    if (typeof v === "number" && isFinite(v)) {
      found = true;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return found ? { min, max } : null;
}

/** Get unique string property values */
function getUniqueValues(data: GeoJSON.FeatureCollection, property: string): string[] {
  const seen = new Set<string>();
  for (const f of data.features) {
    const v = f.properties?.[property];
    if (v != null) seen.add(String(v));
  }
  return Array.from(seen);
}

/** Build a MapLibre interpolate expression for choropleth coloring */
function buildChoroplethExpression(
  data: GeoJSON.FeatureCollection,
  property: string,
  colorRamp: "sequential" | "diverging",
): MapLibreExpression {
  const range = getPropertyRange(data, property);
  if (!range) return ["literal", "#3b82f6"];

  const ramp = COLOR_RAMPS[colorRamp];
  const expr: MapLibreExpression = ["interpolate", ["linear"], ["to-number", ["get", property]]];
  for (const [stop, color] of ramp) {
    expr.push(range.min + stop * (range.max - range.min));
    expr.push(color);
  }
  return expr;
}

/** Build a MapLibre match expression for categorical coloring */
function buildCategoricalExpression(data: GeoJSON.FeatureCollection, property: string): MapLibreExpression {
  const values = getUniqueValues(data, property);
  const ramp = COLOR_RAMPS.categorical;
  const expr: MapLibreExpression = ["match", ["to-string", ["get", property]]];
  for (let i = 0; i < values.length; i++) {
    expr.push(values[i]);
    expr.push(ramp[i % ramp.length]);
  }
  expr.push("#999"); // fallback
  return expr;
}

/** Add a GeoJSON FeatureCollection as a map layer */
export function addGeoJSONLayer(
  map: maplibregl.Map,
  id: string,
  data: GeoJSON.FeatureCollection,
  color: string = "#3b82f6",
  visualization?: import("./types").DatasetVisualization,
) {
  // Remove if exists
  removeAllDatasetLayers(map, id);

  map.addSource(id, {
    type: "geojson",
    data,
  });

  // Detect geometry types in features
  const hasPolygons = data.features.some((f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon");
  const hasLines = data.features.some(
    (f) => f.geometry?.type === "LineString" || f.geometry?.type === "MultiLineString",
  );
  const hasPoints = data.features.some((f) => f.geometry?.type === "Point" || f.geometry?.type === "MultiPoint");

  const vizMode = visualization?.mode ?? "simple";
  const vizProp = visualization?.property;
  const vizRamp = visualization?.colorRamp ?? "sequential";

  // Choropleth or categorical coloring for polygons/lines/circles
  const usePropertyColor = vizMode === "choropleth" && vizProp;
  const useCategorical = vizMode === "choropleth" && vizProp && vizRamp === "categorical";
  const fillColor = usePropertyColor
    ? useCategorical
      ? buildCategoricalExpression(data, vizProp)
      : buildChoroplethExpression(data, vizProp, vizRamp as "sequential" | "diverging")
    : color;

  if (hasPolygons) {
    map.addLayer({
      id: id + "-fill",
      type: "fill",
      source: id,
      paint: {
        "fill-color": fillColor,
        "fill-opacity": usePropertyColor ? 0.7 : 0.2,
      },
    });
    map.addLayer({
      id: id + "-line",
      type: "line",
      source: id,
      paint: {
        "line-color": usePropertyColor ? "#444" : color,
        "line-width": 1.5,
      },
    });
  }
  if (hasLines) {
    map.addLayer({
      id: id + "-line",
      type: "line",
      source: id,
      paint: {
        "line-color": fillColor,
        "line-width": 2,
      },
    });
  }

  // Heatmap mode for point data
  if (hasPoints && vizMode === "heatmap") {
    map.addLayer({
      id: id + "-heatmap",
      type: "heatmap",
      source: id,
      paint: {
        "heatmap-weight": vizProp ? ["interpolate", ["linear"], ["to-number", ["get", vizProp]], 0, 0, 1, 1] : 1,
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0,0,0,0)",
          0.2,
          "rgba(59,130,246,0.3)",
          0.4,
          "rgba(59,130,246,0.6)",
          0.6,
          "rgba(245,158,11,0.7)",
          0.8,
          "rgba(239,68,68,0.8)",
          1,
          "rgba(220,38,38,1)",
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 10, 15, 30],
        "heatmap-opacity": 0.8,
      },
    });
    // Circle overlay at higher zooms
    map.addLayer({
      id: id + "-circle",
      type: "circle",
      source: id,
      paint: {
        "circle-radius": vizProp ? ["interpolate", ["linear"], ["to-number", ["get", vizProp]], 0, 3, 1, 8] : 4,
        "circle-color": color,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#fff",
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0, 9, 0.8],
      },
    });
  } else if (hasPoints) {
    map.addLayer({
      id: id + "-circle",
      type: "circle",
      source: id,
      paint: {
        "circle-radius":
          usePropertyColor && vizProp
            ? [
                "interpolate",
                ["linear"],
                ["to-number", ["get", vizProp]],
                useCategorical ? 0 : (getPropertyRange(data, vizProp)?.min ?? 0),
                4,
                useCategorical ? 1 : (getPropertyRange(data, vizProp)?.max ?? 1),
                10,
              ]
            : 5,
        "circle-color": fillColor,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#fff",
      },
    });
  }
}

/** Remove all layers and source for a dataset */
export function removeAllDatasetLayers(map: maplibregl.Map, id: string) {
  const suffixes = ["-fill", "-line", "-circle", "-heatmap"];
  for (const suffix of suffixes) {
    if (map.getLayer(id + suffix)) map.removeLayer(id + suffix);
  }
  if (map.getSource(id)) map.removeSource(id);
}

/** Remove a GeoJSON layer and its source */
export function removeGeoJSONLayer(map: maplibregl.Map, id: string) {
  removeAllDatasetLayers(map, id);
}

/** Get bounding box string for Overpass */
export function getOverpassBBox(map: maplibregl.Map): string {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`;
}
