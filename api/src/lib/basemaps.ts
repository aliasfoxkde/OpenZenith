/**
 * Basemap registry — the single source of truth for raster basemap tile URLs
 * across the Map (MapLibre) and Globe (CesiumJS) clients.
 *
 * Every tile URL, attribution string, and label behavior lives here so the
 * two clients can never drift apart (they previously kept separate literal
 * tables that had already diverged: the globe lacked light/terrain and the
 * map carried a second copy of the dark URLs in theme.ts).
 */

export interface BasemapDef {
  /** Display label in the basemap picker. */
  label: string;
  /** XYZ tile URL template ({z}/{x}/{y}). */
  url: string;
  /** Attribution HTML required by the tile provider. */
  attribution: string;
  /** The basemap already renders its own labels — no label overlay needed. */
  hasLabels: boolean;
  /** Label-only tiles layered on top when `hasLabels` is false. */
  labelUrl?: string;
  /** Dark basemap — receives the land-contrast overlay and dark UI treatment. */
  isDark: boolean;
}

const CARTO_ATTRIBUTION = "&copy; CartoDB &copy; OSM";
const CARTO = "https://basemaps.cartocdn.com";

export const BASEMAPS = {
  dark: {
    label: "Dark",
    url: `${CARTO}/dark_all/{z}/{x}/{y}@2x.png`,
    attribution: CARTO_ATTRIBUTION,
    hasLabels: true,
    isDark: true,
  },
  // High-contrast dark variant with elevated land visibility
  dark_contrast: {
    label: "Dark+",
    url: `${CARTO}/dark_all/{z}/{x}/{y}@2x.png`,
    attribution: CARTO_ATTRIBUTION,
    hasLabels: true,
    isDark: true,
  },
  dark_nolabel: {
    label: "Dark (no labels)",
    url: `${CARTO}/dark_nolabels/{z}/{x}/{y}@2x.png`,
    attribution: CARTO_ATTRIBUTION,
    hasLabels: false,
    labelUrl: `${CARTO}/dark_only_labels/{z}/{x}/{y}@2x.png`,
    isDark: true,
  },
  voyager: {
    label: "Voyager",
    url: `${CARTO}/rastertiles/voyager/{z}/{x}/{y}@2x.png`,
    attribution: CARTO_ATTRIBUTION,
    hasLabels: true,
    isDark: false,
  },
  light: {
    label: "Light",
    url: `${CARTO}/light_all/{z}/{x}/{y}@2x.png`,
    attribution: CARTO_ATTRIBUTION,
    hasLabels: true,
    isDark: false,
  },
  positron: {
    label: "Positron",
    url: `${CARTO}/light_nolabels/{z}/{x}/{y}@2x.png`,
    attribution: CARTO_ATTRIBUTION,
    hasLabels: false,
    labelUrl: `${CARTO}/light_only_labels/{z}/{x}/{y}@2x.png`,
    isDark: false,
  },
  osm: {
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    hasLabels: true,
    isDark: false,
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri",
    hasLabels: false,
    labelUrl: `${CARTO}/dark_only_labels/{z}/{x}/{y}@2x.png`,
    isDark: false,
  },
  topo: {
    label: "Topographic",
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap",
    hasLabels: true,
    isDark: false,
  },
  terrain: {
    label: "Terrain (Stamen)",
    url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png",
    attribution: "&copy; Stamen Design &copy; Stadia Maps",
    hasLabels: true,
    isDark: false,
  },
} satisfies Record<string, BasemapDef>;

export type BasemapKey = keyof typeof BASEMAPS;

/** Picker order — grouped: dark variants, light, reference, imagery, terrain. */
export const BASEMAP_ORDER: BasemapKey[] = [
  "dark",
  "dark_contrast",
  "dark_nolabel",
  "voyager",
  "light",
  "positron",
  "osm",
  "satellite",
  "topo",
  "terrain",
];

/** Basemaps offered on the globe page (a subset of the map's full set). */
export const GLOBE_BASEMAP_KEYS: BasemapKey[] = ["dark", "satellite", "osm", "voyager", "topo"];

/** Look up a basemap by key, falling back to dark for unknown keys. */
export function getBasemap(key: string): BasemapDef {
  // `key` is unvalidated user input, so the lookup can miss even though the
  // `as BasemapKey` cast hides that from the index signature. Viewing the
  // registry as Partial makes that possible miss visible to the type system.
  const registry = BASEMAPS as Partial<Record<BasemapKey, BasemapDef>>;
  return registry[key as BasemapKey] ?? BASEMAPS.dark;
}

/**
 * Distinct tile-server hostnames used by registry basemaps. The proxy
 * allowlists (api/proxy/tile, api/proxy/wms) spread this in, so a new
 * registry entry is proxyable by construction instead of needing a
 * parallel edit to the proxy routes.
 */
export const BASEMAP_TILE_HOSTS: string[] = [
  ...new Set(Object.values(BASEMAPS).map((b) => new URL(b.url).hostname)),
];
