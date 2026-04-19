import type { LayerHandle } from "./types";

/* ─── Weather Radar (RainViewer) ─── */

export function addRadar(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("radar")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      const data = await res.json();
      const latest = data.radar?.past?.[data.radar.past.length - 1];
      if (!latest || !map.getSource) return;

      try {
        if (!map.getSource("radar")) {
          map.addSource("radar", {
            type: "raster",
            tiles: [`https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`],
            tileSize: 256,
          });
        }

        if (!map.getLayer("radar-layer")) {
          map.addLayer({
            id: "radar-layer",
            type: "raster",
            source: "radar",
            paint: { "raster-opacity": 0.5 },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeRadar(map: maplibregl.Map): void {
  try {
    map.removeLayer("radar-layer");
  } catch {}
  try {
    map.removeSource("radar");
  } catch {}
}
