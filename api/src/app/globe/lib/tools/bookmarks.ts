/**
 * Camera position bookmarks — save/load to localStorage.
 */

export interface Bookmark {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  pitch: number;
  timestamp: number;
}

const STORAGE_KEY = "globe-bookmarks";

/**
 * Reads the saved camera bookmarks back from localStorage key "globe-bookmarks".
 * Returns an empty array on the server (no window), when the key is absent, or
 * when the stored JSON does not parse — it never throws, and never validates
 * the shape of what it parses.
 */
export function loadBookmarks(): Bookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Serialises the list and writes it to localStorage key "globe-bookmarks",
 * replacing whatever was there. No-ops during SSR and swallows write failures
 * (quota exceeded, browser "tracking prevention") rather than surfacing them.
 */
export function saveBookmarks(bookmarks: Bookmark[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    /* tracking prevention */
  }
}

/**
 * Builds a single bookmark record from the camera's cartographic position.
 * `lat`/`lon` are decimal degrees rounded to 4 dp (~11 m), `alt` is metres
 * above the ellipsoid rounded to a whole metre, and `heading`/`pitch` are
 * degrees rounded to 1 dp. `timestamp` is epoch ms. Pure — nothing is written
 * to storage here; call saveBookmarks to persist the resulting list.
 */
export function createBookmark(
  name: string,
  lat: number,
  lon: number,
  alt: number,
  heading: number,
  pitch: number,
): Bookmark {
  return {
    id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    lat: +lat.toFixed(4),
    lon: +lon.toFixed(4),
    alt: Math.round(alt),
    heading: +heading.toFixed(1),
    pitch: +pitch.toFixed(1),
    timestamp: Date.now(),
  };
}
