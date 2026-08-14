"use client";

import { useCallback, useSyncExternalStore } from "react";

const THEME_KEY = "openzenith-theme";
type ThemeMode = "system" | "dark" | "light";

// ── Module-level shared state (single source of truth) ──
let currentMode: ThemeMode = "system";
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

  const getSnapshot = useCallback(() => resolveDark(currentMode), []);

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
