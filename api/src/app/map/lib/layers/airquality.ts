import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Air Quality ─── */

/**
 * Body of /api/airquality — a GeoJSON FeatureCollection whose `features` may
 * be absent when the route returns an error payload.
 */
type AirQualityResponse = { features?: GeoJSON.Feature[] } | null;

/**
 * Add the air-quality layer: US AQI readings for the current map centre,
 * fetched from /api/airquality and rendered as a 12px circle labelled with
 * the AQI number and level. Colour follows the official US AQI bands (green
 * 0-50, yellow 51-100, orange 101-150, red 151-200, purple 201-300, maroon
 * 301+). The query re-runs every 5 minutes and re-centres on wherever the
 * map is at that moment; a payload without `features` is ignored silently.
 */
export function addAirQuality(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("air-quality")) return;

  const doLoad = async () => {
    try {
      const center = map.getCenter();
      const res = await fetch(`/api/airquality?lat=${center.lat.toFixed(2)}&lon=${center.lng.toFixed(2)}`);
      const data = (await res.json()) as AirQualityResponse;
      if (!data?.features) return;

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
    } catch (err) {
      warnLayerError("airQuality", err);
      setStatus(handle, "airQuality", "error");
      }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 300000),
  ); // 5 min
}

/** Remove the AQI label and circle layers plus the `air-quality` source. */
export function removeAirQuality(map: maplibregl.Map): void {
  removeLayerIfPresent(map, "air-quality-label");
  removeLayerIfPresent(map, "air-quality-circle");
  removeSourceIfPresent(map, "air-quality");
}
