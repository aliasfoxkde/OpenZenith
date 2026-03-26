import type { DashboardState } from "./types";
import { DEFAULT_LAYERS, BASEMAPS } from "./constants";

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

export function parseHash(h: string): Partial<DashboardState> {
  try {
    const p = new URLSearchParams(h.replace(/^#/, ""));
    if (!p.toString()) return {};
    const lng = p.get("lng");
    const lat = p.get("lat");
    let center: [number, number] | undefined;
    if (lng && lat) {
      const ln = Number(lng);
      const lt = Number(lat);
      if (!isNaN(ln) && !isNaN(lt)) center = [ln, lt];
    }
    const zoomVal = p.get("zoom");
    const layers = p.get("l");
    const activeLayers = layers ? layers.split(",") : [];
    const vm = p.get("view");
    return {
      center,
      zoom: zoomVal ? Number(zoomVal) : undefined,
      basemap: p.get("bm") || undefined,
      theme: p.get("theme") || undefined,
      viewMode: vm ? (vm === "2d" ? "2d" : vm === "columbus" ? "columbus" : "3d") : undefined,
      layers: {
        ...DEFAULT_LAYERS,
        ...Object.fromEntries(activeLayers.map((l) => [l, true])),
      },
    };
  } catch { return {}; }
}

export function buildHash(s: DashboardState): string {
  const p = new URLSearchParams();
  p.set("lng", s.center[0].toFixed(4));
  p.set("lat", s.center[1].toFixed(4));
  p.set("zoom", s.zoom.toFixed(1));
  if (s.basemap !== "dark") p.set("bm", s.basemap);
  if (s.theme !== "default") p.set("theme", s.theme);
  if (s.viewMode !== "3d") p.set("view", s.viewMode);
  const active = Object.entries(s.layers).filter(([, v]) => v).map(([k]) => k);
  if (active.length) p.set("l", active.join(","));
  return "#" + p.toString();
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
}
