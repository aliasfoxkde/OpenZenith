import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Weather Radar (RainViewer) ─── */

/** One RainViewer frame — `path` is the tile URL prefix for that timestamp. */
type RainViewerFrame = { path: string };

/** Shape of https://api.rainviewer.com/public/weather-maps.json. */
type RainViewerMaps = { radar?: { past?: RainViewerFrame[] } };

/**
 * Add the precipitation-radar layer: the latest past frame of RainViewer's
 * public weather-maps feed is resolved into a tilecache.rainviewer.com tile
 * URL and added as a 256px raster source at 0.5 opacity. The feed is
 * re-fetched every 10 minutes (interval on handle.intervals) so the animation
 * frame stays current, but the source URL is only created once — later
 * refreshes cannot re-point an existing source at a newer timestamp. A failed
 * feed request reports "error"; the inner MapLibre mutations swallow their
 * own errors.
 */
export function addRadar(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("radar")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      if (!res.ok) {
        setStatus(handle, "radar", "error");
        return;
      }
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

/** Remove the radar raster layer and the `radar` source, ignoring "not found" errors. */
export function removeRadar(map: maplibregl.Map): void {
  removeLayerIfPresent(map, "radar-layer");
  removeSourceIfPresent(map, "radar");
}
