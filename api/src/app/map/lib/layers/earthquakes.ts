import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Earthquakes (USGS) with time range filtering ─── */

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

export function setEarthquakeFeed(feed: string) {
  if (FEEDS[feed]) currentFeed = feed;
}

export function setEarthquakeTimeFilter(timeMs: number | null) {
  currentTimeMs = timeMs;
}

export function getEarthquakeTimeRange(): { min: number; max: number } {
  if (allFeatures.length === 0) return { min: Date.now() - 86400000, max: Date.now() };
  const times = allFeatures.map((f) => new Date(f.properties?.time || 0).getTime()).filter((t) => t > 0);
  return { min: Math.min(...times), max: Math.max(...times) };
}

function filterByTime(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  if (currentTimeMs === null) return features;
  const cutoff = currentTimeMs;
  return features.filter((f) => {
    const t = new Date(f.properties?.time || 0).getTime();
    return t > 0 && t <= cutoff;
  });
}

export function addEarthquakes(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("earthquakes")) return;

  const doLoad = async () => {
    try {
      const url = FEEDS[currentFeed] || FEEDS["7d"];
      const res = await fetch(url);
      const data = await res.json();
      allFeatures = data?.features || [];
      const filtered = filterByTime(allFeatures);

      if (!map.getSource) return;
      setStatus(handle, "earthquakes", allFeatures.length ? "loaded" : "empty", allFeatures.length);

      try {
        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: filtered,
        };

        if (!map.getSource("earthquakes")) {
          map.addSource("earthquakes", { type: "geojson", data: geojson });
        } else {
          (map.getSource("earthquakes") as any).setData(geojson);
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
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 60000));
}

export function refreshEarthquakeFilter(map: maplibregl.Map): void {
  if (!map.getSource("earthquakes")) return;
  const filtered = filterByTime(allFeatures);
  const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: filtered };
  try {
    (map.getSource("earthquakes") as any).setData(geojson);
  } catch {}
}

export function removeEarthquakes(map: maplibregl.Map): void {
  ["earthquakes-glow", "earthquakes-circles"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("earthquakes");
  } catch {}
}
