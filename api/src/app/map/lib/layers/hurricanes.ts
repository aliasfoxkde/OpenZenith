import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Hurricane Tracks ─── */

export function addHurricaneTracks(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("hurricanes")) return;

  const doLoad = async () => {
    try {
      // Use server API which parses IBTrACS CSV and returns clean GeoJSON
      const res = await fetch("/api/hurricanes?active=true");
      const data = await res.json();
      if (!map.getSource) return;
      if (!data?.features?.length) return;

      try {
        if (!map.getSource("hurricanes")) {
          map.addSource("hurricanes", { type: "geojson", data });
        } else {
          map.getSource("hurricanes")?.setData(data);
        }

        if (!map.getLayer("hurricanes-points")) {
          map.addLayer({
            id: "hurricanes-points",
            type: "circle",
            source: "hurricanes",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "wind"], 0, 4, 34, 5, 64, 6, 96, 7, 130, 9],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "wind"],
                0,
                "#fbbf24",
                34,
                "#f97316",
                64,
                "#f97316",
                96,
                "#ef4444",
                130,
                "#dc2626",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#fff",
            },
          });

          // Glow layer
          if (!map.getLayer("hurricanes-glow")) {
            map.addLayer({
              id: "hurricanes-glow",
              type: "circle",
              source: "hurricanes",
              paint: {
                "circle-radius": ["interpolate", ["linear"], ["get", "wind"], 0, 8, 64, 14, 130, 22],
                "circle-color": [
                  "interpolate",
                  ["linear"],
                  ["get", "wind"],
                  0,
                  "rgba(251,191,36,0.15)",
                  64,
                  "rgba(249,115,22,0.15)",
                  130,
                  "rgba(220,38,38,0.2)",
                ],
                "circle-blur": 1,
              },
            });
          }

          // Labels for storm names
          if (!map.getLayer("hurricanes-labels")) {
            map.addLayer({
              id: "hurricanes-labels",
              type: "symbol",
              source: "hurricanes",
              layout: {
                "text-field": ["coalesce", ["get", "name"], ""],
                "text-size": 11,
                "text-offset": [0, 1.5],
                "text-anchor": "top",
                "text-max-width": 8,
              },
              paint: {
                "text-color": "#f97316",
                "text-halo-color": "rgba(0,0,0,0.9)",
                "text-halo-width": 2,
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
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeHurricaneTracks(map: maplibregl.Map): void {
  try {
    map.removeLayer("hurricanes-labels");
  } catch {}
  try {
    map.removeLayer("hurricanes-glow");
  } catch {}
  try {
    map.removeLayer("hurricanes-points");
  } catch {}
  try {
    map.removeSource("hurricanes");
  } catch {}
}

/* ─── Hurricane Animation ─── */

export function startHurricaneAnimation(
  map: maplibregl.Map,
  handle: LayerHandle,
  callback: (progress: number) => void,
): void {
  const source = map.getSource("hurricanes");
  if (!source?._data?.features) return;

  const times = source._data.features
    .filter(
      (f: GeoJSON.Feature) => f.geometry?.type === "Point" && (f.properties as Record<string, unknown>)?.timestamp,
    )
    .map((f: GeoJSON.Feature) => (f.properties as Record<string, unknown>).timestamp as number)
    .filter((t: number) => t > 0)
    .sort((a: number, b: number) => a - b);

  if (times.length === 0) return;

  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const duration = 15000;
  const startTime = Date.now();

  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = (elapsed % duration) / duration;
    const currentTime = minTime + progress * (maxTime - minTime);
    callback(progress);

    try {
      if (map.getLayer("hurricanes-points")) {
        map.setFilter("hurricanes-points", [
          "all",
          ["==", ["geometry-type"], "Point"],
          ["<=", ["get", "timestamp"], currentTime],
        ]);
      }
    } catch {}
  };

  animate();
  handle.intervals.push(setInterval(animate, 100));
}

export function stopHurricaneAnimation(map: maplibregl.Map, handle: LayerHandle): void {
  while (handle.intervals.length > 0) {
    clearInterval(handle.intervals.pop()!);
  }
  try {
    if (map.getLayer("hurricanes-points")) {
      map.setFilter("hurricanes-points", ["==", ["geometry-type"], "Point"]);
    }
  } catch {}
}
