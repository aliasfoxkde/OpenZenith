import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Earthquakes (USGS) with time range filtering ─── */

/**
 * USGS summary feed body. `features` is optional because the feed also serves
 * bare `{error: ...}` bodies on upstream failure.
 */
type UsgsFeed = { features?: GeoJSON.Feature[] };

// Available USGS feeds
const FEEDS: Record<string, string> = {
  "1h": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
  "1d": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  "7d": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson",
  "30d": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson",
};

let currentFeed = "7d";
let allFeatures: GeoJSON.Feature[] = [];
let currentTimeMs: number | null = null; // null = show all

/**
 * Select which USGS summary feed subsequent loads use: "1h", "1d", "7d" or
 * "30d". Module-level state shared with addEarthquakes and the timeline UI —
 * it does not trigger a fetch, and an unknown feed name is ignored, leaving
 * the previous selection (initially "7d") in force.
 */
export function setEarthquakeFeed(feed: string) {
  if (FEEDS[feed]) currentFeed = feed;
}

/**
 * Set the timeline cutoff applied to the quake list: only events at or
 * before this epoch-ms timestamp are drawn. `null` clears the filter so every
 * feed event renders. Pure state — call refreshEarthquakeFilter to apply it
 * to an already-added layer.
 */
export function setEarthquakeTimeFilter(timeMs: number | null) {
  currentTimeMs = timeMs;
}

/**
 * Report the epoch-ms `{min, max}` window spanned by the events currently
 * held in module state, so the timeline slider can be scaled to the feed.
 * Before any feed has loaded (or when it held no usable times) it returns a
 * synthetic window of the last 24 hours ending now.
 */
export function getEarthquakeTimeRange(): { min: number; max: number } {
  if (allFeatures.length === 0) return { min: Date.now() - 86400000, max: Date.now() };
  const times = allFeatures.map(featureTimeMs).filter((t) => t > 0);
  return { min: Math.min(...times), max: Math.max(...times) };
}

/**
 * Feature time in epoch ms — 0 when the feed carries no usable time. Typed
 * structurally because features come from parsed JSON, where RFC 7946 allows
 * `properties` to be absent or null.
 */
function featureTimeMs(f: { properties?: { time?: number } | null }): number {
  return new Date(f.properties?.time || 0).getTime();
}

function filterByTime(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  if (currentTimeMs === null) return features;
  const cutoff = currentTimeMs;
  return features.filter((f) => {
    const t = featureTimeMs(f);
    return t > 0 && t <= cutoff;
  });
}

/**
 * Add the earthquake layer, fetching the feed chosen by setEarthquakeFeed
 * directly from earthquake.usgs.gov every 60 seconds (interval on
 * handle.intervals). Events are sized and coloured by magnitude — 3px green
 * at M0 growing to 16px red at M7, over a matching glow — and filtered
 * through the time cutoff set by setEarthquakeTimeFilter. The feed is cached
 * in module state so the timeline helpers and refreshEarthquakeFilter can
 * re-filter it without refetching; status carries the unfiltered event count.
 */
export function addEarthquakes(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("earthquakes")) return;

  const doLoad = async () => {
    try {
      const url = FEEDS[currentFeed] || FEEDS["7d"];
      if (!url) {
        // Unreachable: currentFeed is only set to a key verified present in
        // FEEDS and "7d" is a literal entry — guarded so fetch always gets a
        // string. Matches the !res.ok error style below.
        setStatus(handle, "earthquakes", "error");
        return;
      }
      const res = await fetch(url);
      if (!res.ok) {
        setStatus(handle, "earthquakes", "error");
        return;
      }
      const data = (await res.json()) as UsgsFeed | null;
      allFeatures = data?.features || [];
      const filtered = filterByTime(allFeatures);

      setStatus(handle, "earthquakes", allFeatures.length ? "loaded" : "empty", allFeatures.length);

      try {
        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: filtered,
        };

        if (!map.getSource("earthquakes")) {
          map.addSource("earthquakes", { type: "geojson", data: geojson });
        } else {
          map.getSource("earthquakes")?.setData(geojson);
        }

        // Circle layer — sized by magnitude
        if (!map.getLayer("earthquakes-circles")) {
          map.addLayer({
            id: "earthquakes-circles",
            type: "circle",
            source: "earthquakes",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 0, 3, 3, 6, 5, 10, 7, 16],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "mag"],
                0,
                "#22c55e",
                3,
                "#eab308",
                5,
                "#f97316",
                7,
                "#ef4444",
              ],
              "circle-opacity": 0.7,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(255,255,255,0.2)",
            },
          });
        }

        // Glow layer underneath
        if (!map.getLayer("earthquakes-glow")) {
          map.addLayer({
            id: "earthquakes-glow",
            type: "circle",
            source: "earthquakes",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 0, 6, 3, 12, 5, 20, 7, 32],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "mag"],
                0,
                "rgba(34,197,94,0.15)",
                3,
                "rgba(234,179,8,0.15)",
                5,
                "rgba(249,115,22,0.15)",
                7,
                "rgba(239,68,68,0.2)",
              ],
              "circle-blur": 1,
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch (err) {
      warnLayerError("earthquakes", err);
      setStatus(handle, "earthquakes", "error");
    }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 60000),
  );
}

/**
 * Re-apply the current time filter to the already-fetched events and
 * setData the `earthquakes` source, without a network round-trip. No-op when
 * the layer is not currently added.
 */
export function refreshEarthquakeFilter(map: maplibregl.Map): void {
  if (!map.getSource("earthquakes")) return;
  const filtered = filterByTime(allFeatures);
  const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: filtered };
  try {
    map.getSource("earthquakes")?.setData(geojson);
  } catch {}
}

/**
 * Remove the quake circle and glow layers plus the `earthquakes` source. The
 * module-level feed cache and the feed/time-filter selections are
 * deliberately retained, so re-adding restores the previous timeline state
 * on the next fetch.
 */
export function removeEarthquakes(map: maplibregl.Map): void {
  ["earthquakes-glow", "earthquakes-circles"].forEach((id) => {
    removeLayerIfPresent(map, id);
  });
  removeSourceIfPresent(map, "earthquakes");
}
