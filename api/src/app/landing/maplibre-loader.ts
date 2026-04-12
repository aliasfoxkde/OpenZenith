/** CDN loader for MapLibre GL JS — shared by landing page and other light map views. */

export function loadMapLibre(): Promise<void> {
  const w = window as any;
  if (w.maplibregl) return Promise.resolve();
  if (w._maplibreLoading) return w._maplibreLoading;
  w._maplibreLoading = new Promise<void>((resolve, reject) => {
    if (!document.querySelector('link[href*="maplibre-gl"]')) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css";
      document.head.appendChild(css);
    }
    const js = document.createElement("script");
    js.src = "https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js";
    js.onload = () => resolve();
    js.onerror = () => reject(new Error("MapLibre GL script failed to load"));
    document.head.appendChild(js);
  });
  return w._maplibreLoading;
}

export function waitForMapLibre(timeoutMs = 15000): Promise<any> {
  const w = window as any;
  if (w.maplibregl) return Promise.resolve(w.maplibregl);
  return loadMapLibre().then(
    () =>
      new Promise((resolve, reject) => {
        const start = Date.now();
        const iv = setInterval(() => {
          if (w.maplibregl) {
            clearInterval(iv);
            resolve(w.maplibregl);
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(iv);
            reject(new Error("MapLibre GL failed to load"));
          }
        }, 100);
      }),
  );
}
