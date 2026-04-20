"use client";

import { useCallback, useSyncExternalStore, useEffect, useRef } from "react";

const THEME_KEY = "openzenith-theme";
type ThemeMode = "system" | "dark" | "light";

/** React hook that subscribes to the system dark/light theme preference.
 *  Supports three modes: "system" (follows OS), "dark", "light".
 *  Persists choice to localStorage. Returns `true` if dark. */
export function useTheme() {
  const modeRef = useRef<ThemeMode>("system");

  const subscribe = useCallback((callback: () => void) => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (_e: MediaQueryListEvent) => callback();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const getSnapshot = useCallback(() => {
    const mode = modeRef.current;
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, []);

  const getServerSnapshot = useCallback(() => false, []);

  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Read persisted preference on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light" || saved === "system") {
        modeRef.current = saved;
      }
    } catch {
      /* storage unavailable */
    }
    // Force re-render after reading persisted value
    subscribe(() => {})();
  }, []);

  return dark;
}

/** Set the theme mode. Call from a theme toggle UI. */
export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* storage unavailable */
  }
  // Dispatch storage event so all hooks re-evaluate
  window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));
  // Also dispatch a generic event for same-tab listeners
  window.dispatchEvent(new Event("theme-change"));
  document.documentElement.setAttribute(
    "data-theme",
    mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode,
  );
}

/** Get the current theme mode ("system" | "dark" | "light"). */
export function getThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light" || saved === "system") return saved;
  } catch {
    /* storage unavailable */
  }
  return "system";
}
