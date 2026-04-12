"use client";

import { useCallback, useSyncExternalStore } from "react";

/** React hook that subscribes to the system dark/light theme preference. */
export function useTheme() {
  const subscribe = useCallback((callback: () => void) => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (_e: MediaQueryListEvent) => callback();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const getSnapshot = useCallback(() => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, []);
  const getServerSnapshot = useCallback(() => false, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
