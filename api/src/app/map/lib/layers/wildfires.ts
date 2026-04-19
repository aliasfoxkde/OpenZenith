import type { LayerHandle } from "./types";

/* ─── Wildfires (NASA FIRMS) ─── */

export function addWildfires(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("wildfires")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/wildfires");
      const data = await res.json();
      if (!data?.features?.length) return;

      try {
        if (!map.getSource("wildfires")) {
          map.addSource("wildfires", { type: "geojson", data });
        } else {
          map.getSource("wildfires")?.setData(data);
        }

        if (!map.getLayer("wildfires-heat")) {
          map.addLayer({
            id: "wildfires-heat",
            type: "heatmap",
            source: "wildfires",
            maxzoom: 9,
            paint: {
              "heatmap-weight": ["interpolate", ["linear"], ["get", "confidence"], 0, 0.1, 100, 1],
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(0,0,0,0)",
                0.2,
                "rgba(255,170,0,0.4)",
                0.4,
                "rgba(255,136,0,0.6)",
                0.6,
                "rgba(255,102,0,0.8)",
                0.8,
                "rgba(255,0,0,0.9)",
                1,
                "rgba(255,0,0,1)",
              ],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 9, 20],
              "heatmap-opacity": 0.7,
            },
          });
        }

        if (!map.getLayer("wildfires-circles")) {
          map.addLayer({
            id: "wildfires-circles",
            type: "circle",
            source: "wildfires",
            minzoom: 6,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "confidence"], 0, 2, 30, 3, 50, 4, 80, 6, 100, 8],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "confidence"],
                0,
                "#ffaa00",
                30,
                "#ff8800",
                50,
                "#ff6600",
                80,
                "#ff0000",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 0.5,
              "circle-stroke-color": "rgba(255,255,255,0.3)",
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
  handle.intervals.push(setInterval(doLoad, 3600000)); // 1 hour
}

export function removeWildfires(map: maplibregl.Map): void {
  try {
    map.removeLayer("wildfires-circles");
  } catch {}
  try {
    map.removeLayer("wildfires-heat");
  } catch {}
  try {
    map.removeSource("wildfires");
  } catch {}
}
