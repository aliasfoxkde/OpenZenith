/**
 * URL hash and localStorage persistence for Studio map state.
 *
 * URL hash encodes: center, zoom, basemap (shareable links).
 * localStorage persists: sidebar, activeTab (user preferences).
 */

export interface MapViewState {
  center: [number, number];
  zoom: number;
  basemap: string;
}

export interface UserPreferences {
  sidebarOpen: boolean;
  activeTab: string;
}

const LS_KEY = "openzenith-studio-prefs";

/* ─── URL hash ─── */

export function encodeMapHash(state: MapViewState): string {
  const { center, zoom, basemap } = state;
  const parts = [
    `${center[1].toFixed(4)},${center[0].toFixed(4)}`,
    `${zoom.toFixed(1)}`,
    basemap,
  ];
  return `#${parts.join("/")}`;
}

export function decodeMapHash(hash: string): Partial<MapViewState> | null {
  const raw = hash.replace(/^#\/?/, "");
  const parts = raw.split("/");
  if (parts.length < 2) return null;

  const [latLon, zoomStr, basemap] = parts;
  const [latStr, lonStr] = latLon.split(",");
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  const zoom = parseFloat(zoomStr);

  if (isNaN(lat) || isNaN(lon) || isNaN(zoom)) return null;

  return {
    center: [lon, lat] as [number, number],
    zoom: Math.max(0, Math.min(20, zoom)),
    ...(basemap ? { basemap } : {}),
  };
}

/* ─── localStorage ─── */

export function loadPreferences(): Partial<UserPreferences> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function savePreferences(prefs: Partial<UserPreferences>): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadPreferences();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...existing, ...prefs }));
  } catch {}
}
