/**
 * Studio basemap picker - derived from the shared registry (src/lib/basemaps.ts)
 * rather than a private copy, so provider changes land here by construction.
 * The studio caps view zoom at 15, below every included provider's maxzoom.
 */
import { BASEMAPS as BASEMAP_REGISTRY } from "@/lib/basemaps";

const STUDIO_BASEMAP_KEYS = ["dark", "voyager", "light", "osm", "satellite", "topo"] as const;

/**
 * Studio basemap picker options: the six registry keys `dark`, `voyager`, `light`, `osm`,
 * `satellite`, and `topo`, each mapped to `{ label, url, attribution }` — the picker label,
 * the XYZ raster tile URL template (`{z}/{x}/{y}`), and the attribution HTML the provider
 * requires. The registry's other fields are dropped here because the studio never overlays
 * label tiles and caps zoom at 15, below every included provider's `maxzoom`.
 */
export const BASEMAPS: Record<string, { label: string; url: string; attribution: string }> = Object.fromEntries(
  STUDIO_BASEMAP_KEYS.map((key) => {
    const def = BASEMAP_REGISTRY[key];
    return [key, { label: def.label, url: def.url, attribution: def.attribution }];
  }),
);

/** Fallback map center, `[longitude, latitude]` in degrees (MapLibre order, not `[lat, lon]`). */
export const DEFAULT_CENTER: [number, number] = [0, 20];
/** Fallback MapLibre zoom level (fractional web-mercator zoom) when the URL hash has none. */
export const DEFAULT_ZOOM = 2;

/**
 * Query presets for the Overpass tool, each `{ label, query, description }` where `query` is
 * Overpass QL. `{{bbox}}` inside a query is replaced at run time with the current map bounds
 * as `south,west,north,east` (degrees) before the tool POSTs to `/api/overpass`. The final
 * entry carries an empty query as the escape hatch for hand-written QL.
 */
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

/**
 * Import formats the Data tool accepts, each `{ ext, label, mime }` with `ext` keeping its
 * leading dot. Feeds both the file input's `accept` attribute and the extension list shown in
 * the drop zone; `.zip` means a zipped Shapefile, and `.geojson`/`.json` are both GeoJSON.
 */
export const SUPPORTED_FORMATS = [
  { ext: ".geojson", label: "GeoJSON", mime: "application/geo+json" },
  { ext: ".json", label: "GeoJSON", mime: "application/json" },
  { ext: ".csv", label: "CSV", mime: "text/csv" },
  { ext: ".tsv", label: "TSV", mime: "text/tab-separated-values" },
  { ext: ".gpx", label: "GPX", mime: "application/gpx+xml" },
  { ext: ".kml", label: "KML", mime: "application/vnd.google-earth.kml+xml" },
  { ext: ".zip", label: "Shapefile", mime: "application/zip" },
];

/**
 * Ten hex colors cycled across uploaded datasets: `createDataset` assigns
 * `DATASET_COLORS[datasetCounter % length]`, so the Nth import of a session gets the Nth
 * color and imports past the tenth wrap back to the start of the palette.
 */
export const DATASET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f43f5e",
];
