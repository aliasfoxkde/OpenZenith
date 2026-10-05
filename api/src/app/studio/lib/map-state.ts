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

/**
 * User-level studio preferences persisted across visits: `sidebarOpen` (sidebar expanded),
 * `activeTab` (sidebar tab id as a plain string), and `imperial` (render distances/areas in
 * ft/mi/ac instead of m/km/ha in the measurement tools).
 */
export interface UserPreferences {
  sidebarOpen: boolean;
  activeTab: string;
  imperial: boolean;
}

const LS_KEY = "openzenith-studio-prefs";

/* ─── URL hash ─── */

/**
 * Serialize a map view into a shareable URL hash of the form
 * `#<lat>,<lon>/<zoom>/<basemap>` — latitude first, longitude second, each fixed to 4
 * decimals, zoom to 1 decimal — even though `state.center` is MapLibre's `[lon, lat]`. The
 * studio writes the result to the address bar with `history.replaceState` on every
 * moveend/zoomend.
 */
export function encodeMapHash(state: MapViewState): string {
  const { center, zoom, basemap } = state;
  const parts = [`${center[1].toFixed(4)},${center[0].toFixed(4)}`, zoom.toFixed(1), basemap];
  return `#${parts.join("/")}`;
}

/**
 * Inverse of encodeMapHash, tolerant of a missing leading `#` or `/`. Returns only the fields
 * recoverable from the string: fewer than two `/`-separated parts, or a lat/lon/zoom that
 * fails `parseFloat`, yields null; a missing third part simply omits `basemap`. `center` comes
 * back in MapLibre `[lon, lat]` order (the hash stores latitude first) and `zoom` is clamped
 * to 0-20, so an out-of-range hash cannot zoom the map past the tile sources.
 */
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

/**
 * Read the studio preferences object from localStorage key `openzenith-studio-prefs`,
 * returning a partial because any field may be absent from an older write. Returns `{}` when
 * called server-side, when the key is unset, or when the stored JSON is corrupt, so callers
 * can fall back per field.
 */
export function loadPreferences(): Partial<UserPreferences> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    // Stored preferences are written by savePreferences below; cast at the
    // read boundary and let callers narrow the partial shape themselves.
    return JSON.parse(raw) as Partial<UserPreferences>;
  } catch {
    return {};
  }
}

/**
 * Merge `prefs` over the currently stored preferences and write the result back to localStorage
 * key `openzenith-studio-prefs`, so each UI effect can persist a single field without
 * clobbering the others. No-op server-side, and silently swallows storage failures (private
 * browsing, quota), so a failed write never surfaces to the user.
 */
export function savePreferences(prefs: Partial<UserPreferences>): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadPreferences();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...existing, ...prefs }));
  } catch {}
}
