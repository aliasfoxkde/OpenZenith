import type { DashboardState, LayerState } from "./types";
import { DEFAULT_LAYERS, BASEMAPS, SIDEBAR_SECTIONS } from "./constants";

export function waitForCesium(timeout = 20000): Promise<any> {
  return new Promise((res, rej) => {
    const w = window as any;
    if (w.Cesium) return res(w.Cesium);
    const s = Date.now();
    const iv = setInterval(() => {
      if (w.Cesium) { clearInterval(iv); res(w.Cesium); }
      else if (Date.now() - s > timeout) { clearInterval(iv); rej(new Error("CesiumJS failed to load")); }
    }, 100);
  });
}

/**
 * Category shortcut mapping: category key → list of layer IDs.
 * If a category name is used in the URL, all its layers are enabled.
 */
const CATEGORY_MAP: Record<string, string[]> = {};
for (const sec of SIDEBAR_SECTIONS) {
  CATEGORY_MAP[sec.key] = sec.layerIds as string[];
}

/** All known layer IDs for validating individual layer names */
const ALL_LAYER_IDS = Object.keys(DEFAULT_LAYERS);

/**
 * Parse a clean hash format:
 *   #zoom/lat/lng/bm=dark/theme=default/l=earthquakes+flights+space
 *
 * Layers can be:
 * - Individual: "earthquakes", "flights", "satellites"
 * - Category shortcuts: "overlays", "realtime", "space", "infrastructure"
 * - Mixed: "earthquakes+flights+space" (individual + category)
 */
export function parseHash(h: string): Partial<DashboardState> {
  try {
    const hash = h.replace(/^#\/?/, "");
    if (!hash) return {};
    const parts = hash.split("&").map((p) => p.split("="));
    const get = (key: string) => parts.find((p) => p[0] === key)?.[1];

    // Position from path segments: #zoom/lat/lng
    const pathParts = parts[0]?.[0]?.split("/") || [];
    const zoomVal = pathParts[0];
    const lat = pathParts[1];
    const lng = pathParts[2];

    let center: [number, number] | undefined;
    if (lng && lat) {
      const ln = Number(lng);
      const lt = Number(lat);
      if (!isNaN(ln) && !isNaN(lt)) center = [ln, lt];
    }

    // Layers: expand categories
    const layersStr = get("l") || "";
    const activeLayers = layersStr
      ? layersStr.split("+").flatMap((token) => CATEGORY_MAP[token] || (ALL_LAYER_IDS.includes(token) ? [token] : []))
      : [];

    const vm = get("view");
    return {
      center,
      zoom: zoomVal ? Number(zoomVal) : undefined,
      basemap: get("bm") || undefined,
      theme: get("theme") || undefined,
      viewMode: vm ? (vm === "2d" ? "2d" : vm === "columbus" ? "columbus" : "3d") : undefined,
      layers: {
        ...DEFAULT_LAYERS,
        ...Object.fromEntries(activeLayers.map((l) => [l, true])),
      },
    };
  } catch { return {}; }
}

/**
 * Build a clean, human-readable hash:
 *   #2.0/30.0000/-10.0000/bm=dark/l=earthquakes+events+space
 *
 * Only includes non-default values to minimize URL length.
 * Uses `+` separator (no encoding needed).
 */
export function buildHash(s: DashboardState): string {
  const parts: string[] = [];

  // Path: zoom/lat/lng
  parts.push(`${s.zoom.toFixed(1)}/${s.center[1].toFixed(4)}/${s.center[0].toFixed(4)}`);

  // Optional params
  if (s.basemap !== "dark") parts.push(`bm=${s.basemap}`);
  if (s.theme !== "default") parts.push(`theme=${s.theme}`);
  if (s.viewMode !== "3d") parts.push(`view=${s.viewMode}`);

  // Layers: use category shortcuts when ALL layers in a category are active
  const active = Object.entries(s.layers).filter(([, v]) => v).map(([k]) => k);
  if (active.length > 0) {
    // Check if all layers in a category are active
    const usedCategories: string[] = [];
    const remaining = new Set(active);

    for (const [catKey, catLayers] of Object.entries(CATEGORY_MAP)) {
      if (catLayers.every((l) => remaining.has(l))) {
        usedCategories.push(catKey);
        catLayers.forEach((l) => remaining.delete(l));
      }
    }

    // Add any remaining individual layers
    const allLayerTokens = [...usedCategories, ...remaining];
    parts.push(`l=${allLayerTokens.join("+")}`);
  }

  return "#" + parts.join("&");
}

export function fmtTime(ts: number | null): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function safeCopy(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  } catch { /* clipboard unavailable */ }
}

export function elevationColor(elev: number): string {
  if (elev < 0) return "#1a5276";
  if (elev < 200) return "#1e8449";
  if (elev < 500) return "#27ae60";
  if (elev < 1000) return "#f4d03f";
  if (elev < 2000) return "#e67e22";
  if (elev < 4000) return "#d35400";
  return "#922b21";
}

export function switchBasemapOnViewer(viewer: any, key: string) {
  const Cesium = (window as any).Cesium;
  const bm = BASEMAPS[key];
  const imageryLayers = viewer.imageryLayers;

  while (imageryLayers.length > 0) {
    imageryLayers.remove(imageryLayers.get(0));
  }

  if (bm?.url) {
    imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: bm.url,
      credit: "",
      maximumLevel: 18,
    }));
  }
}

export function removeEntities(viewer: any, prefix: string, entitiesRef: Record<string, any>) {
  const toRemove: any[] = [];
  viewer.entities.values.forEach((e: any) => {
    if (e.id && e.id.startsWith(prefix)) toRemove.push(e);
  });
  toRemove.forEach((e: any) => viewer.entities.remove(e));

  if (prefix === "sat-" && entitiesRef["sat-points"]) {
    viewer.scene.primitives.remove(entitiesRef["sat-points"]);
    delete entitiesRef["sat-points"];
  }
  if (prefix === "elev-" && entitiesRef["elev-points"]) {
    viewer.scene.primitives.remove(entitiesRef["elev-points"]);
    delete entitiesRef["elev-points"];
  }
  viewer.scene.requestRender();
}

export function toggleImageryOverlay(viewer: any, cesiumRef: any, name: string, url?: string, opacity?: number) {
  const Cesium = cesiumRef;
  if (!Cesium) return;
  const layers = viewer.imageryLayers;
  const existing = layers._layers.find((l: any) => {
    const providerUrl = l._imageryProvider?.url || "";
    return providerUrl.includes(name);
  });
  if (existing) {
    layers.remove(existing);
  } else if (url) {
    layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url, credit: "" }));
    const idx = layers.length - 1;
    if (opacity !== undefined && layers.get(idx)) {
      (layers.get(idx) as any).alpha = opacity;
    }
  }
  viewer.scene.requestRender();
}
