"use client";

import { useCallback, useSyncExternalStore, useEffect, useRef } from "react";

const THEME_KEY = "openzenith-theme";
type ThemeMode = "system" | "dark" | "light";

// ── Global listeners so all useTheme() instances re-render on change ──
const listeners = new Set<() => void>();

function notifyAll() {
  listeners.forEach((fn) => fn());
}

function subscribeGlobal(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

/** Resolve the current effective dark/light state. */
function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

/** React hook that subscribes to the system dark/light theme preference.
 *  Supports three modes: "system" (follows OS), "dark", "light".
 *  Persists choice to localStorage. Returns `true` if dark. */
export function useTheme() {
  const modeRef = useRef<ThemeMode>("system");

  const subscribe = useCallback((callback: () => void) => {
    // Re-render on manual theme change
    const unsub = subscribeGlobal(callback);
    // Also re-render on OS preference change
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => callback();
    mq.addEventListener("change", handler);
    return () => {
      unsub();
      mq.removeEventListener("change", handler);
    };
  }, []);

  const getSnapshot = useCallback(() => {
    return resolveDark(modeRef.current);
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
    notifyAll();
  }, []);

  return dark;
}

/** Cycle theme: system → dark → light → system.
 *  Returns the new mode and updates localStorage + data-theme attribute. */
export function cycleTheme(): ThemeMode {
  const current = getThemeMode();
  const next: ThemeMode = current === "system" ? "dark" : current === "dark" ? "light" : "system";
  setThemeMode(next);
  return next;
}

/** Set the theme mode. Updates localStorage, DOM, and triggers React re-renders. */
export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* storage unavailable */
  }
  document.documentElement.setAttribute(
    "data-theme",
    resolveDark(mode) ? "dark" : "light",
  );
  // Notify all useTheme() subscribers
  notifyAll();
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
