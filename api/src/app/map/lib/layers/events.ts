import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Natural Events (NASA EONET) ─── */

export function addNaturalEvents(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("natural-events")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200");
      const data = await res.json();
      if (!map.getSource || !data.features) return;
      setStatus(handle, "warnings", "loaded", data.features.length);

      try {
        if (!map.getSource("natural-events")) {
          map.addSource("natural-events", { type: "geojson", data });
        } else {
          map.getSource("natural-events")?.setData(data);
        }

        if (!map.getLayer("natural-events-points")) {
          map.addLayer({
            id: "natural-events-points",
            type: "circle",
            source: "natural-events",
            paint: {
              "circle-radius": 6,
              "circle-color": [
                "match",
                ["coalesce", ["get", "category"], ""],
                ["volcanoes", "severeStorms", "icebergs"],
                "#ef4444",
                ["wildfires", "seaLakeIce"],
                "#f97316",
                ["floods", "landslides"],
                "#3b82f6",
                "#eab308",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(255,255,255,0.6)",
            },
          });

          // Glow underneath
          if (!map.getLayer("natural-events-glow")) {
            map.addLayer({
              id: "natural-events-glow",
              type: "circle",
              source: "natural-events",
              paint: {
                "circle-radius": 14,
                "circle-color": "rgba(239, 68, 68, 0.2)",
                "circle-blur": 1,
              },
            });
          }
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

export function removeNaturalEvents(map: maplibregl.Map): void {
  try {
    map.removeLayer("natural-events-glow");
  } catch {}
  try {
    map.removeLayer("natural-events-points");
  } catch {}
  try {
    map.removeSource("natural-events");
  } catch {}
}
