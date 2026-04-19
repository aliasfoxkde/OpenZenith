import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Weather Warnings ─── */

export function addWarnings(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("warnings")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/weather/warnings");
      const data = await res.json();
      if (!map.getSource || !data.features) return;
      setStatus(handle, "warnings", "loaded", data.features.length);

      try {
        if (!map.getSource("warnings")) {
          map.addSource("warnings", { type: "geojson", data });
        } else {
          map.getSource("warnings")?.setData(data);
        }

        // Fill layer
        if (!map.getLayer("warnings-fill")) {
          map.addLayer({
            id: "warnings-fill",
            type: "fill",
            source: "warnings",
            paint: {
              "fill-color": [
                "match",
                ["downcase", ["get", "Event"]],
                ["tornado warning", "extreme wind warning"],
                "#ef4444",
                ["severe thunderstorm warning", "flash flood warning"],
                "#f97316",
                "#eab308",
              ],
              "fill-opacity": 0.15,
            },
          });
        }

        // Outline layer with dash
        if (!map.getLayer("warnings-outline")) {
          map.addLayer({
            id: "warnings-outline",
            type: "line",
            source: "warnings",
            paint: {
              "line-color": [
                "match",
                ["downcase", ["get", "Event"]],
                ["tornado warning", "extreme wind warning"],
                "#ef4444",
                ["severe thunderstorm warning", "flash flood warning"],
                "#f97316",
                "#eab308",
              ],
              "line-width": 2,
              "line-opacity": 0.7,
              "line-dasharray": [2, 2],
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
  handle.intervals.push(setInterval(doLoad, 300000));
}

export function removeWarnings(map: maplibregl.Map): void {
  ["warnings-outline", "warnings-fill"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("warnings");
  } catch {}
}
