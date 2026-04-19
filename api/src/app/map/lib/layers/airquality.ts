import type { LayerHandle } from "./types";

/* ─── Air Quality ─── */

export function addAirQuality(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("air-quality")) return;

  const doLoad = async () => {
    try {
      const center = map.getCenter();
      const res = await fetch(`/api/airquality?lat=${center.lat.toFixed(2)}&lon=${center.lng.toFixed(2)}`);
      const data = await res.json();
      if (!map.getSource || !data?.features) return;

      try {
        if (!map.getSource("air-quality")) {
          map.addSource("air-quality", { type: "geojson", data });
        } else {
          map.getSource("air-quality")?.setData(data);
        }

        if (!map.getLayer("air-quality-circle")) {
          map.addLayer({
            id: "air-quality-circle",
            type: "circle",
            source: "air-quality",
            paint: {
              "circle-radius": 12,
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "us_aqi"],
                0,
                "#22c55e",
                50,
                "#22c55e",
                51,
                "#eab308",
                100,
                "#eab308",
                101,
                "#f97316",
                150,
                "#f97316",
                151,
                "#ef4444",
                200,
                "#ef4444",
                201,
                "#a855f7",
                300,
                "#a855f7",
                301,
                "#7f1d1d",
              ],
              "circle-opacity": 0.7,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#fff",
            },
          });
        }

        if (!map.getLayer("air-quality-label")) {
          map.addLayer({
            id: "air-quality-label",
            type: "symbol",
            source: "air-quality",
            layout: {
              "text-field": ["concat", ["to-string", ["get", "us_aqi"]], "\n", ["get", "aqi_level"]],
              "text-size": 11,
              "text-anchor": "center",
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": "#fff",
              "text-halo-color": "rgba(0,0,0,0.8)",
              "text-halo-width": 1.5,
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
  handle.intervals.push(setInterval(doLoad, 300000)); // 5 min
}

export function removeAirQuality(map: maplibregl.Map): void {
  try {
    map.removeLayer("air-quality-label");
  } catch {}
  try {
    map.removeLayer("air-quality-circle");
  } catch {}
  try {
    map.removeSource("air-quality");
  } catch {}
}
