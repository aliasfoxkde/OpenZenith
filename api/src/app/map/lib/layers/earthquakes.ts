import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Earthquakes ─── */

export function addEarthquakes(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("earthquakes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
      const data = await res.json();
      if (!map.getSource) return;
      setStatus(handle, "earthquakes", data?.features?.length ? "loaded" : "empty", data?.features?.length || 0);

      try {
        if (!map.getSource("earthquakes")) {
          map.addSource("earthquakes", { type: "geojson", data });
        } else {
          map.getSource("earthquakes")?.setData(data);
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
