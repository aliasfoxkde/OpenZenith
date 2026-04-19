import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Space Weather (NOAA Aurora Forecast) ─── */

export function addSpaceWeather(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("spaceWeather")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://services.swpc.noaa.gov/json/ovation_aurora_forecast_map.json");
      const data = await res.json();
      const coords = data?.coordinates || [];
      setStatus(handle, "spaceWeather", coords.length ? "loaded" : "empty", coords.length / 3);

      if (!map.getSource) return;
      try {
        // NOAA returns [lon, lat, intensity] triplets
        const features: GeoJSON.Feature[] = [];
        for (let i = 0; i < coords.length - 2; i += 3) {
          const lon = coords[i];
          const lat = coords[i + 1];
          const intensity = coords[i + 2];
          if (intensity > 0) {
            features.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: { intensity },
            });
          }
        }

        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

        if (!map.getSource("spaceWeather")) {
          map.addSource("spaceWeather", { type: "geojson", data: geojson });
        } else {
          map.getSource("spaceWeather")?.setData(geojson);
        }

        if (!map.getLayer("spaceWeather-points")) {
          map.addLayer({
            id: "spaceWeather-points",
            type: "circle",
            source: "spaceWeather",
            paint: {
              "circle-radius": 6,
              "circle-color": [
                "interpolate", ["linear"], ["get", "intensity"],
                0, "rgba(0,255,136,0.1)",
                2, "rgba(0,255,136,0.3)",
                4, "rgba(0,255,136,0.6)",
                8, "rgba(0,255,136,0.9)",
              ],
              "circle-blur": 1,
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      setStatus(handle, "spaceWeather", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000)); // 10 min — aurora forecast updates slowly
}

export function removeSpaceWeather(map: maplibregl.Map): void {
  ["spaceWeather-points"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("spaceWeather"); } catch {}
}
