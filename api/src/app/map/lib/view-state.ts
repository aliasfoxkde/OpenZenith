/**
 * Map view state: types, defaults, and the URL-hash codec.
 *
 * Extracted from map/page.tsx. Pure state with no MapLibre dependency,
 * so the hash round-trip is unit-testable without a map instance.
 */
import { LAYERS } from "@/lib/layers/registry";
import { MAP_2D_LAYER_IDS } from "./layers";

export interface ElevationPin {
  lat: number;
  lon: number;
  elevation: number | null;
  status: "ok" | "no_data" | "unavailable";
  surfaceType: "land" | "inland_water" | "ocean" | "seafloor" | "unknown";
}

export interface MapViewState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  basemap: string;
  layers: Record<string, boolean>;
}

export const LAYER_STATE_KEY = "openzenith-map-layers";
export const BOOKMARKS_KEY = "openzenith-bookmarks";

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
        const parsed = JSON.parse(saved);
        for (const key of Object.keys(parsed)) {
          if (key in layers) layers[key] = parsed[key];
        }
      }
    } catch {}
  }
  return layers;
}

export const DEFAULT_STATE: MapViewState = {
  center: [0, 0],
  zoom: 2.5,
  bearing: 0,
  pitch: 0,
  basemap: "satellite",
  layers: buildDefaultLayers(),
};

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
