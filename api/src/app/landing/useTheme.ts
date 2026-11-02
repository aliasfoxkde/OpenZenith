"use client";

import { useCallback, useSyncExternalStore } from "react";

const THEME_KEY = "openzenith-theme";
type ThemeMode = "system" | "dark" | "light";

// ── Module-level shared state (single source of truth) ──
let currentMode: ThemeMode = "system";
let initialized = false;
const listeners = new Set<() => void>();

function notifyAll() {
  for (const fn of listeners) fn();
}

function subscribeGlobal(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Resolve the current effective dark/light state. */
function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false;
}

/** Read the effective dark/light state right now (must run client-side). */
export function isDarkNow(): boolean {
  return resolveDark(currentMode);
}

/**
 * The palette the user actually sees right now.
 *
 * Before `initTheme()` runs, `currentMode` is still the module default
 * ("system"), which loses a saved explicit choice: a user who picked "light"
 * on a dark OS would briefly get the OS palette. The pre-paint inline script
 * in the root layout already resolved the saved mode into `data-theme`, so
 * trust that attribute until initialization has synced the module state.
 */
function currentPalette(): boolean {
  if (!initialized && typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "light") return attr === "dark";
  }
  return resolveDark(currentMode);
}

/** React hook — returns `true` if dark theme is active. */
export function useTheme() {
  const subscribe = useCallback((callback: () => void) => {
    const unsub = subscribeGlobal(callback);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      // If mode is "system", OS change should trigger re-render
      if (currentMode === "system") callback();
    };
    mq.addEventListener("change", handler);
    return () => {
      unsub();
      mq.removeEventListener("change", handler);
    };
  }, []);

  const getSnapshot = useCallback(() => currentPalette(), []);

  // getServerSnapshot must agree with the server render, so it stays a
  // constant. Surfaces that must be correct on the FIRST paint are driven by
  // the --oz-* CSS variables (see globals.css), which the pre-paint inline
  // script resolves via data-theme; this hook only supplies the boolean
  // flags that React-rendered chrome needs.
  const dark = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return dark;
}

/**
 * Initialize theme on the client.
 * Call once on mount (e.g., in a top-level useEffect).
 * Reads localStorage, sets the module-level mode, applies data-theme.
 */
export function initTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light" || saved === "system") {
      currentMode = saved;
    }
  } catch {
    /* storage unavailable */
  }
  applyTheme(currentMode);
  initialized = true;
  // Stored mode can differ from what the hook resolved pre-init (module
  // default is "system"); notify so `useTheme()` consumers re-render with the
  // restored value instead of staying on the stale one.
  notifyAll();
  return currentMode;
}

/** Set the theme mode. Updates everything: module state, localStorage, DOM, React. */
export function setThemeMode(mode: ThemeMode): void {
  currentMode = mode;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* storage unavailable */
  }
  applyTheme(mode);
  notifyAll();
}

/** Get the current theme mode. */
export function getThemeMode(): ThemeMode {
  return currentMode;
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolveDark(mode) ? "dark" : "light");
  }
}
