"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
        // SW registration is best-effort — but never silently: a broken sw.js
        // (e.g. TypeScript served as plain JS) hid here for months once.
        console.warn("[sw] registration failed:", err);
      });
    }
  }, []);

  return null;
}
