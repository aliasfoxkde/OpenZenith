import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── Weather Radar (RainViewer) ─── */

/** One RainViewer frame — `path` is the tile URL prefix for that timestamp. */
type RainViewerFrame = { path: string };

/** Shape of https://api.rainviewer.com/public/weather-maps.json. */
type RainViewerMaps = { radar?: { past?: RainViewerFrame[] } };

export function addRadar(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("radar")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      const data = (await res.json()) as RainViewerMaps;
      const past = data.radar?.past;
      const latest = past ? past[past.length - 1] : undefined;
      if (!latest) return;

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
    } catch (err) {
      warnLayerError("radar", err);
      setStatus(handle, "radar", "error");
      }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 600000),
  );
}

export function removeRadar(map: maplibregl.Map): void {
  try {
    map.removeLayer("radar-layer");
  } catch {}
  try {
    map.removeSource("radar");
  } catch {}
}
