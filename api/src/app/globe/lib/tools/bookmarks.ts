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

export function loadBookmarks(): Bookmark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBookmarks(bookmarks: Bookmark[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch { /* tracking prevention */ }
}

export function createBookmark(name: string, lat: number, lon: number, alt: number, heading: number, pitch: number): Bookmark {
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
