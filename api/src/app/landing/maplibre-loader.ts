/** CDN loader for MapLibre GL JS — shared by landing page and other light map views. */

function injectMapLibreScript(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!document.querySelector('link[href*="maplibre-gl"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css";
      document.head.appendChild(css);
    }
    const js = document.createElement("script");
    js.src = "https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js";
    js.onload = () => { resolve(); };
    js.onerror = () => {
      // Drop the failed tag so the retry below injects a fresh one.
      js.remove();
      reject(new Error("MapLibre GL script failed to load"));
    };
    document.head.appendChild(js);
  });
}

export function loadMapLibre(attempts = 3): Promise<void> {
  // The `as MapLibreGL | undefined` widening is load-bearing: window.maplibregl
  // collides with the `declare namespace maplibregl` global (same name on
  // globalThis), which makes the property's visible type non-nullable even
  // though it is genuinely absent until the CDN script loads.
  if (window.maplibregl as MapLibreGL | undefined) return Promise.resolve();
  if (window._maplibreLoading) return window._maplibreLoading;
  // Concurrent callers share one retry loop; only after the final failure is
  // the slot cleared, so a later caller starts fresh instead of awaiting a
  // permanently-rejected promise (one unpkg blip used to brick every map on
  // the page until a manual refresh).
  window._maplibreLoading = (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await injectMapLibreScript();
        return;
      } catch (err) {
        if (attempt >= attempts) {
          window._maplibreLoading = undefined;
          throw err;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  })();
  return window._maplibreLoading;
}

export function waitForMapLibre(timeoutMs = 15000): Promise<MapLibreGL> {
  const existing = window.maplibregl as MapLibreGL | undefined;
  if (existing) return Promise.resolve(existing);
  return loadMapLibre().then(
    () =>
      new Promise<MapLibreGL>((resolve, reject) => {
        const start = Date.now();
        const iv = setInterval(() => {
          const mlgl = window.maplibregl as MapLibreGL | undefined;
          if (mlgl) {
            clearInterval(iv);
            resolve(mlgl);
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(iv);
            reject(new Error("MapLibre GL failed to load"));
          }
        }, 100);
      }),
  );
}
