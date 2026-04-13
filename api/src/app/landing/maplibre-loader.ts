/** CDN loader for MapLibre GL JS — shared by landing page and other light map views. */

export function loadMapLibre(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function waitForMapLibre(timeoutMs = 15000): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
