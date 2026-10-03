/** CDN loader for MapLibre GL JS — shared by landing page and other light map views. */

export function loadMapLibre(): Promise<void> {
  // The `as MapLibreGL | undefined` widening is load-bearing: window.maplibregl
  // collides with the `declare namespace maplibregl` global (same name on
  // globalThis), which makes the property's visible type non-nullable even
  // though it is genuinely absent until the CDN script loads.
  if (window.maplibregl as MapLibreGL | undefined) return Promise.resolve();
  if (window._maplibreLoading) return window._maplibreLoading;
  window._maplibreLoading = new Promise<void>((resolve, reject) => {
    if (!document.querySelector('link[href*="maplibre-gl"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css";
      document.head.appendChild(css);
    }
    const js = document.createElement("script");
    js.src = "https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js";
    js.onload = () => { resolve(); };
    js.onerror = () => { reject(new Error("MapLibre GL script failed to load")); };
    document.head.appendChild(js);
  });
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
