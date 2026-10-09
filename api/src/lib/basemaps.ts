/**
 * Basemap registry — the single source of truth for raster basemap tile URLs
 * across the Map (MapLibre), Globe (CesiumJS), Studio, and landing-hero
 * clients.
 *
 * Every tile URL, attribution string, and label behavior lives here so the
 * clients can never drift apart (they previously kept separate literal
 * tables that had already diverged: the globe lacked light/terrain and the
 * map carried a second copy of the dark URLs in theme.ts).
 *
 * Provider note (2026-09): CARTO's raster basemaps began serving
 * "API KEY REQUIRED" watermark tiles to unauthenticated clients, and Stamen
 * tiles moved behind Stadia keys (401). Every watermarked entry was swapped
 * to Esri's keyless hosted services, probed live before the switch. If a
 * basemap ever renders as repeated provider text instead of geography,
 * check here first.
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
  /**
   * Native maximum tile zoom of the provider. Sources pass this so clients
   * overzoom the last level instead of requesting 404 tiles past the end.
   */
  maxzoom: number;
}

const ESRI_ATTRIBUTION = "&copy; Esri";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_DARK_BASE = `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const ESRI_DARK_LABELS = `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;
const ESRI_LIGHT_BASE = `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`;
const ESRI_LIGHT_LABELS = `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;

/**
 * Basemap definition table keyed by registry key (`dark`, `satellite`, ...).
 * Each value is a `BasemapDef`: display label, XYZ tile URL template, the
 * attribution HTML the provider requires, label/overlay flags, and the
 * provider's native `maxzoom` so clients overzoom the last real level instead
 * of requesting tiles past the end. `dark`/`dark_contrast` share Esri's dark
 * canvas service and differ only in the UI treatment clients apply.
 */
export const BASEMAPS = {
  dark: {
    label: "Dark",
    url: ESRI_DARK_BASE,
    attribution: ESRI_ATTRIBUTION,
    hasLabels: false,
    labelUrl: ESRI_DARK_LABELS,
    isDark: true,
    maxzoom: 16,
  },
  // High-contrast dark variant with elevated land visibility
  dark_contrast: {
    label: "Dark+",
    url: ESRI_DARK_BASE,
    attribution: ESRI_ATTRIBUTION,
    hasLabels: false,
    labelUrl: ESRI_DARK_LABELS,
    isDark: true,
    maxzoom: 16,
  },
  dark_nolabel: {
    label: "Dark (no labels)",
    url: ESRI_DARK_BASE,
    attribution: ESRI_ATTRIBUTION,
    // Deliberately labelless: no baked labels and no overlay — the map's
    // addLabelLayer skips the overlay when labelUrl is absent.
    hasLabels: false,
    isDark: true,
    maxzoom: 16,
  },
  voyager: {
    label: "Streets",
    url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION,
    hasLabels: true,
    isDark: false,
    maxzoom: 19,
  },
  light: {
    label: "Light",
    url: ESRI_LIGHT_BASE,
    attribution: ESRI_ATTRIBUTION,
    hasLabels: false,
    labelUrl: ESRI_LIGHT_LABELS,
    isDark: false,
    maxzoom: 16,
  },
  positron: {
    label: "Positron",
    url: ESRI_LIGHT_BASE,
    attribution: ESRI_ATTRIBUTION,
    hasLabels: false,
    labelUrl: ESRI_LIGHT_LABELS,
    isDark: false,
    maxzoom: 16,
  },
  osm: {
    label: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    hasLabels: true,
    isDark: false,
    maxzoom: 19,
  },
  satellite: {
    label: "Satellite",
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION,
    hasLabels: false,
    labelUrl: ESRI_DARK_LABELS,
    isDark: false,
    maxzoom: 19,
  },
  topo: {
    label: "Topographic",
    url: "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenTopoMap",
    hasLabels: true,
    isDark: false,
    maxzoom: 17,
  },
  terrain: {
    label: "Terrain",
    url: `${ESRI}/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION,
    hasLabels: true,
    isDark: false,
    maxzoom: 13,
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
export const BASEMAP_TILE_HOSTS: string[] = [...new Set(Object.values(BASEMAPS).map((b) => new URL(b.url).hostname))];
