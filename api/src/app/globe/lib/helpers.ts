/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DashboardState } from "./types";
import { DEFAULT_LAYERS, BASEMAPS, SIDEBAR_SECTIONS } from "./constants";

/**
 * Category shortcut mapping: category key → list of layer IDs.
 * If a category name is used in the URL, all its layers are enabled.
 */
const CATEGORY_MAP = new Map<string, string[]>();
for (const sec of SIDEBAR_SECTIONS) {
  CATEGORY_MAP.set(sec.key, sec.layerIds);
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
    // hash is non-empty here, so parts[0][0] is always a string (possibly "")
    const pathParts = parts[0][0].split("/");
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
      ? layersStr.split("+").flatMap((token) => CATEGORY_MAP.get(token) || (ALL_LAYER_IDS.includes(token) ? [token] : []))
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
  } catch {
    return {};
  }
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
  if (s.basemap !== "satellite") parts.push(`bm=${s.basemap}`);
  if (s.theme !== "default") parts.push(`theme=${s.theme}`);
  if (s.viewMode !== "3d") parts.push(`view=${s.viewMode}`);

  // Layers: use category shortcuts when ALL layers in a category are active
  const active = Object.entries(s.layers)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (active.length > 0) {
    // Check if all layers in a category are active
    const usedCategories: string[] = [];
    const remaining = new Set(active);

    for (const [catKey, catLayers] of CATEGORY_MAP) {
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

/**
 * Format an epoch-milliseconds timestamp as a locale HH:MM:SS string for the
 * status list (output follows the browser locale and timezone). Anything
 * falsy — null, 0 or undefined — returns the "--:--:--" placeholder instead of
 * a formatted midnight, so an epoch of exactly 0 is indistinguishable from no
 * data.
 */
export function fmtTime(ts: number | null): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Best-effort copy of `text` to the clipboard. Prefers the async Clipboard API
 * when navigator.clipboard.writeText exists (it is absent in insecure contexts
 * even though the DOM types declare it), otherwise falls back to the
 * deprecated execCommand("copy") driven through a fixed, invisible textarea
 * appended to document.body and removed in the same tick. Fire-and-forget:
 * no return value and every failure — rejected write, missing clipboard,
 * thrown execCommand — is swallowed, so a caller cannot tell success from
 * failure.
 */
export function safeCopy(text: string) {
  // navigator.clipboard is absent in insecure contexts even though the DOM
  // types declare it as always present, so widen it before probing.
  const clipboard = navigator.clipboard as Clipboard | undefined;
  try {
    if (clipboard?.writeText) {
      // Best-effort write: a rejection here is no more actionable than the
      // fallback path failing, and the caller gets no return value.
      clipboard.writeText(text).catch(() => {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      // execCommand is deprecated, but in insecure contexts — where the async
      // Clipboard API above is absent — it remains the only copy primitive.
      (document as { execCommand?: (commandId: string) => boolean }).execCommand?.("copy");
      document.body.removeChild(ta);
    }
  } catch {
    /* clipboard unavailable */
  }
}

/**
 * Map an elevation in meters to one of seven discrete hex colors for the
 * elevation-color layer: <0 m → #1a5276 (deep water), <200 m → #1e8449,
 * <500 m → #27ae60, <1,000 m → #f4d03f, <2,000 m → #e67e22,
 * <4,000 m → #d35400, and #922b21 at 4,000 m and above. Band edges are
 * upper-exclusive (each test is `<`), so exactly 200 m falls in the <500 m
 * band, and there is no interpolation between bands.
 */
export function elevationColor(elev: number): string {
  if (elev < 0) return "#1a5276";
  if (elev < 200) return "#1e8449";
  if (elev < 500) return "#27ae60";
  if (elev < 1000) return "#f4d03f";
  if (elev < 2000) return "#e67e22";
  if (elev < 4000) return "#d35400";
  return "#922b21";
}

/**
 * Swap the globe's imagery to the named basemap: every existing imagery layer
 * is removed first, then — when `key` resolves in the BASEMAPS registry — a
 * UrlTemplateImageryProvider is added with that url, an empty credit and
 * maximumLevel set to the registry's maxzoom. `key` comes from user state and
 * may be missing from the registry, in which case the globe is left with zero
 * imagery layers and only the scene base color visible; there is no fallback.
 * The Cesium global is read off window, so this must run after cesium-init has
 * loaded Cesium — with an unknown key no provider is constructed and the
 * global is never dereferenced.
 */
export function switchBasemapOnViewer(viewer: any, key: string) {
  const Cesium = (window as any).Cesium;
  // key comes from user state, so it may not be in the registry
  const bm = BASEMAPS[key] as { label: string; url: string; maxzoom: number } | undefined;
  const imageryLayers = viewer.imageryLayers;

  while (imageryLayers.length > 0) {
    imageryLayers.remove(imageryLayers.get(0));
  }

  if (bm?.url) {
    imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: bm.url,
        credit: "",
        maximumLevel: bm.maxzoom,
      }),
    );
  }
}

/**
 * Create a retry guard for layer interval callbacks.
 * Tracks consecutive failures and provides exponential backoff delay.
 * Returns { shouldRetry, recordSuccess, recordFailure }.
 *
 * After MAX_CONSECUTIVE_FAILURES consecutive failures, stops retrying.
 * Between failures, backs off by 2x up to maxDelayMs.
 */
export function createRetryGuard(opts?: { maxFailures?: number; baseDelay?: number; maxDelay?: number }) {
  const maxFailures = opts?.maxFailures ?? 5;
  const baseDelay = opts?.baseDelay ?? 5000;
  const maxDelay = opts?.maxDelay ?? 120000;

  let consecutiveFailures = 0;
  let lastFailureTime = 0;

  return {
    get shouldRetry(): boolean {
      if (consecutiveFailures >= maxFailures) return false;
      if (consecutiveFailures > 0) {
        const delay = Math.min(baseDelay * Math.pow(2, consecutiveFailures - 1), maxDelay);
        return Date.now() - lastFailureTime >= delay;
      }
      return true;
    },
    get failureCount(): number {
      return consecutiveFailures;
    },
    recordSuccess() {
      consecutiveFailures = 0;
    },
    recordFailure() {
      consecutiveFailures++;
      lastFailureTime = Date.now();
    },
  };
}

/**
 * Remove every entity whose id starts with `prefix` from viewer.entities, and
 * any tracked companion primitive: for the "sat-" and "elev-" prefixes the
 * PointPrimitiveCollection stored under entitiesRef["sat-points"] /
 * ["elev-points"] is also removed from viewer.scene.primitives and the ref key
 * deleted. Mutates `entitiesRef`, so callers must pass the same object the
 * layer loaders populated. Ends with scene.requestRender(), which is what
 * makes the change visible on a viewer created with requestRenderMode.
 */
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

/**
 * Toggle a single imagery overlay identified by URL substring: if an existing
 * imagery layer's provider url contains `name` it is removed, otherwise `url`
 * is added as a UrlTemplateImageryProvider (with optional maximumLevel) and
 * the new top layer's alpha set to `opacity` (0-1). Matching walks
 * imageryLayers._layers and _imageryProvider.url — Cesium private APIs, so
 * this is Cesium-version sensitive — which is why every url passed here must
 * embed `name` verbatim (the radar/raster loaders use NASA GIBS, BlueMarble
 * and VIIRS tile URLs that do). Returns nothing; no-ops when the Cesium ref is
 * unset or when there is no match and no url, and always calls
 * scene.requestRender() at the end.
 */
export function toggleImageryOverlay(
  viewer: any,
  cesiumRef: any,
  name: string,
  url?: string,
  opacity?: number,
  maximumLevel?: number,
) {
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
    const opts: any = { url, credit: "" };
    if (maximumLevel !== undefined) opts.maximumLevel = maximumLevel;
    layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider(opts));
    const idx = layers.length - 1;
    if (opacity !== undefined && layers.get(idx)) {
      (layers.get(idx)).alpha = opacity;
    }
  }
  viewer.scene.requestRender();
}
