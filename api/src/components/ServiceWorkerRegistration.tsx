"use client";

import { useEffect } from "react";

/**
 * Renders nothing; registers the `/sw.js` service worker once on mount.
 *
 * Registration is best-effort: a rejected promise — for example a `sw.js`
 * served as untranspiled TypeScript — is logged as a console warning instead
 * of throwing, so a broken worker never breaks the page.
 */
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
