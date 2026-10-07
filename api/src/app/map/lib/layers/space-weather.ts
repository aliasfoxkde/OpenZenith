import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Space Weather (NOAA Aurora Forecast) ─── */

/**
 * NOAA SWPC OVATION aurora forecast. `coordinates` is a flat grid of
 * `[longitude, latitude, aurora power (0..100)]` triples.
 */
interface AuroraForecast {
  coordinates?: Array<[number, number, number]>;
}

/**
 * Add the aurora-forecast layer: NOAA SWPC OVATION latest forecast fetched
 * from services.swpc.noaa.gov, whose flat `coordinates` grid of [lon, lat,
 * power 0..100] triples is converted into one point feature per non-zero
 * cell on the `spaceWeather` GeoJSON source. Rendered as a single blurred
 * circle layer whose colour ramps from faint to solid green as intensity
 * rises from 0 to 8. Reports "loaded" (with the grid count) or "empty" when
 * the forecast is empty, "error" on a non-ok or failed request, and
 * refreshes every 10 minutes.
 */
export function addSpaceWeather(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("spaceWeather")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://services.swpc.noaa.gov/json/ovation_aurora_latest.json");
      if (!res.ok) {
        setStatus(handle, "spaceWeather", "error");
        return;
      }
      const data = (await res.json()) as AuroraForecast | null;
      const coords = data?.coordinates || [];
      setStatus(handle, "spaceWeather", coords.length ? "loaded" : "empty", coords.length);

      try {
        const features: GeoJSON.Feature[] = [];
        for (const coord of coords) {
          const lon = coord[0];
          const lat = coord[1];
          const intensity = coord[2];
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
                "interpolate",
                ["linear"],
                ["get", "intensity"],
                0,
                "rgba(0,255,136,0.1)",
                2,
                "rgba(0,255,136,0.3)",
                4,
                "rgba(0,255,136,0.6)",
                8,
                "rgba(0,255,136,0.9)",
              ],
              "circle-blur": 1,
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch (err) {
      warnLayerError("spaceWeather", err);
      setStatus(handle, "spaceWeather", "error");
    }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 600000), // 10 min — aurora forecast updates slowly
  );
}

/** Remove the aurora point layer and the `spaceWeather` source, ignoring "not found" errors. */
export function removeSpaceWeather(map: maplibregl.Map): void {
  ["spaceWeather-points"].forEach((id) => {
    removeLayerIfPresent(map, id);
  });
  removeSourceIfPresent(map, "spaceWeather");
}
