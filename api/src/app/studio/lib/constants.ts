export const BASEMAPS: Record<string, { label: string; url: string; attribution: string }> = {
  dark: {
    label: "Dark",
    url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    attribution: "\u00a9 CartoDB \u00a9 OSM",
  },
  voyager: {
    label: "Voyager",
    url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    attribution: "\u00a9 CartoDB \u00a9 OSM",
  },
  light: {
    label: "Light",
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
    attribution: "\u00a9 CartoDB \u00a9 OSM",
  },
  osm: {
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "\u00a9 OpenStreetMap contributors",
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "\u00a9 Esri",
  },
  topo: {
    label: "Topographic",
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "\u00a9 OpenTopoMap",
  },
};

export const DEFAULT_CENTER: [number, number] = [0, 20];
export const DEFAULT_ZOOM = 2;

export const OVERPASS_PRESETS = [
  {
    label: "Amenities in view",
    query: 'node["amenity"]({{bbox}});out body;',
    description: "Restaurants, cafes, shops, etc.",
  },
  {
    label: "Buildings in view",
    query: 'way["building"]({{bbox}});out geom;',
    description: "All building footprints",
  },
  {
    label: "Roads in view",
    query: 'way["highway"]({{bbox}});out geom;',
    description: "All road networks",
  },
  {
    label: "Water features",
    query: 'way["natural"="water"]({{bbox}});out geom;',
    description: "Lakes, rivers, ponds",
  },
  {
    label: "Trees and forests",
    query: 'way["natural"="tree"]({{bbox}});node["natural"="tree"]({{bbox}});out;',
    description: "Individual trees and forest areas",
  },
  {
    label: "Power infrastructure",
    query: 'way["power"="line"]({{bbox}});out geom;',
    description: "Power lines and electrical infrastructure",
  },
  {
    label: "Custom query",
    query: "",
    description: "Write your own Overpass QL query",
  },
];

export const SUPPORTED_FORMATS = [
  { ext: ".geojson", label: "GeoJSON", mime: "application/geo+json" },
  { ext: ".json", label: "GeoJSON", mime: "application/json" },
  { ext: ".csv", label: "CSV", mime: "text/csv" },
  { ext: ".tsv", label: "TSV", mime: "text/tab-separated-values" },
  { ext: ".gpx", label: "GPX", mime: "application/gpx+xml" },
  { ext: ".kml", label: "KML", mime: "application/vnd.google-earth.kml+xml" },
  { ext: ".zip", label: "Shapefile", mime: "application/zip" },
];

export const DATASET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e",
];
