/**
 * Map view state: types, defaults, and the URL-hash codec.
 *
 * Extracted from map/page.tsx. Pure state with no MapLibre dependency,
 * so the hash round-trip is unit-testable without a map instance.
 */
import { LAYERS } from "@/lib/layers/registry";
import { MAP_2D_LAYER_IDS } from "./layers";

/**
 * One elevation probe dropped on the map: the queried coordinate in decimal
 * degrees, the elevation in metres (`null` when nothing was returned), the
 * lookup outcome, and the classified surface the point fell on.
 */
export interface ElevationPin {
  lat: number;
  lon: number;
  elevation: number | null;
  status: "ok" | "no_data" | "unavailable";
  surfaceType: "land" | "inland_water" | "ocean" | "seafloor" | "unknown";
}

/** Complete serializable 2D-map view: camera plus basemap and layer toggles. */
export interface MapViewState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  basemap: string;
  layers: Record<string, boolean>;
}

/** localStorage key holding the persisted `Record<layerId, enabled>` map. */
export const LAYER_STATE_KEY = "openzenith-map-layers";
/** localStorage key holding the user's saved `Bookmark[]` list. */
export const BOOKMARKS_KEY = "openzenith-bookmarks";

/**
 * Basemap key matching the visitor's current theme preference: "voyager"
 * for light, "dark" for dark. Reads the app's `openzenith-theme` localStorage
 * entry, falling back to `prefers-color-scheme` for system mode, and returns
 * "dark" during SSR (no window).
 */
export function getDefaultBasemap(): string {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = localStorage.getItem("openzenith-theme");
    if (saved === "light") return "voyager";
    if (saved === "dark") return "dark";
  } catch {}
  // system mode: follow OS preference
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "voyager";
}

/**
 * Initial layer-visibility map for a fresh page load: the four map-only
 * toggles (hillshade on; contour/terrain3d/boundaries off), every registry
 * layer that MAP_2D_LAYER_IDS makes available at its own `defaultEnabled`
 * value, then any stored overrides from LAYER_STATE_KEY merged on top — keys
 * that are not already present in the map are ignored, so retired layer ids
 * in old localStorage cannot resurrect themselves. Returns hardcoded values
 * on the server (localStorage is unavailable).
 */
export function buildDefaultLayers(): Record<string, boolean> {
  const layers: Record<string, boolean> = {
    // Map-specific layers
    hillshade: true,
    contour: false,
    terrain3d: false,
    boundaries: false,
  };
  // Registry defaults for 2D-compatible layers
  for (const layer of LAYERS) {
    if (MAP_2D_LAYER_IDS.has(layer.id)) {
      layers[layer.id] = layer.defaultEnabled;
    }
  }
  // Restore saved layer preferences from localStorage
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(LAYER_STATE_KEY);
      if (saved) {
        // Written by this app as JSON.stringify(<Record<string, boolean>>).
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        for (const key of Object.keys(parsed)) {
          // parsed comes from JSON.parse of stored layer prefs — a non-boolean
          // entry falls back to false, which is how it already rendered.
          if (key in layers) layers[key] = parsed[key] ?? false;
        }
      }
    } catch {}
  }
  return layers;
}

/**
 * State used when no URL hash is present: world view at zoom 2.5, no
 * rotation or tilt, the "satellite" basemap, and buildDefaultLayers() —
 * evaluated once at module load, so it also bakes in whatever localStorage
 * held when the module was first imported.
 */
export const DEFAULT_STATE: MapViewState = {
  center: [0, 0],
  zoom: 2.5,
  bearing: 0,
  pitch: 0,
  basemap: "satellite",
  layers: buildDefaultLayers(),
};

/**
 * Decode a shareable URL hash (with or without the leading `#`) into the
 * view-state fields it specifies. Two spellings are accepted: tile form
 * `x/y/z` (Web Mercator tile indices, converted to a center coordinate,
 * with `b`/`p`/`bm` as optional bearing in degrees, pitch in degrees, and
 * basemap key), or center form `lng=..&lat=..&zoom=..` (also `c=lng,lat`).
 * Absent fields come back as `undefined` so callers can merge onto
 * DEFAULT_STATE; malformed or out-of-range input yields `{}`.
 */
export function parseHash(hash: string): Partial<MapViewState> {
  try {
    const h = hash.replace(/^#/, "");
    if (!h) return {};
    const params = new URLSearchParams(h);
    // x/y/z = tile coordinates → compute center from tile
    const tx = params.get("x");
    const ty = params.get("y");
    const tz = params.get("z");
    if (tx && ty && tz) {
      const x = Number(tx),
        y = Number(ty),
        z = Number(tz);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z) && z >= 0 && z <= 22) {
        const n = Math.pow(2, z);
        const lng = (x / n) * 360 - 180;
        const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
        const lat = (latRad * 180) / Math.PI;
        return {
          center: [lng, lat],
          zoom: z,
          bearing: params.has("b") ? Number(params.get("b")) : undefined,
          pitch: params.has("p") ? Number(params.get("p")) : undefined,
          basemap: params.get("bm") || undefined,
        };
      }
    }
    // lng/lat/zoom = center coordinates
    const c = params.get("c");
    const lng = params.get("lng");
    const lat = params.get("lat");
    let center: [number, number] | undefined;
    if (c) {
      const parts = c.split(",").map(Number);
      if (parts.length === 2 && parts.every((n) => !isNaN(n))) center = parts as [number, number];
    } else if (lng && lat) {
      const ln = Number(lng);
      const lt = Number(lat);
      if (!isNaN(ln) && !isNaN(lt)) center = [ln, lt];
    }
    const zoomVal = params.get("zoom");
    return {
      center,
      zoom: zoomVal ? Number(zoomVal) : undefined,
      bearing: params.has("b") ? Number(params.get("b")) : undefined,
      pitch: params.has("p") ? Number(params.get("p")) : undefined,
      basemap: params.get("bm") || undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Encode a view state back into a URL hash (leading `#` included) using the
 * center spelling: `lng`/`lat` at 4 decimal places (~11 m), `zoom` at 1, plus
 * `b`/`p` only when non-zero and `bm` only when the basemap differs from
 * getDefaultBasemap() — so a default-looking view produces the shortest hash.
 * Layer visibility is deliberately not encoded.
 */
export function buildHash(state: MapViewState): string {
  const p = new URLSearchParams();
  p.set("lng", state.center[0].toFixed(4));
  p.set("lat", state.center[1].toFixed(4));
  p.set("zoom", state.zoom.toFixed(1));
  if (state.bearing) p.set("b", state.bearing.toFixed(1));
  if (state.pitch) p.set("p", state.pitch.toFixed(1));
  if (state.basemap !== getDefaultBasemap()) p.set("bm", state.basemap);
  return "#" + p.toString();
}

/** A named saved view: center/zoom plus the layer-visibility snapshot. */
export interface Bookmark {
  name: string;
  center: [number, number];
  zoom: number;
  layers: Record<string, boolean>;
  timestamp: number;
}
