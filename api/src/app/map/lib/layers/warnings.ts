import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Weather Warnings ─── */

/**
 * Body of /api/weather/warnings — the route proxies NWS alerts as a GeoJSON
 * FeatureCollection, and serves `{error}` instead when upstream fails.
 */
type WarningsResponse = { features?: GeoJSON.Feature[] };

/**
 * Add the active weather-warning polygons (NWS alerts relayed by
 * /api/weather/warnings as a GeoJSON FeatureCollection). Renders two layers
 * over one `warnings` source: a 0.15-opacity fill and a dashed 2px outline,
 * both coloured by the alert's `event` property — red for tornado/extreme
 * wind, orange for severe thunderstorm/flash flood, amber otherwise. The
 * fetch re-runs every 5 minutes via an interval on handle.intervals and calls
 * setData on the existing source rather than recreating it; a missing
 * `features` field aborts silently, while a non-ok response or a fetch
 * failure reports "error".
 */
export function addWarnings(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("warnings")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/weather/warnings");
      if (!res.ok) {
        setStatus(handle, "warnings", "error");
        return;
      }
      const data = (await res.json()) as WarningsResponse;
      if (!data.features) return;
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
                ["downcase", ["get", "event"]],
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
                ["downcase", ["get", "event"]],
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
    } catch (err) {
      warnLayerError("warnings", err);
      setStatus(handle, "warnings", "error");
    }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 300000),
  );
}

/** Remove the warnings outline and fill layers plus the `warnings` source, ignoring "not found" errors. */
export function removeWarnings(map: maplibregl.Map): void {
  ["warnings-outline", "warnings-fill"].forEach((id) => {
    removeLayerIfPresent(map, id);
  });
  removeSourceIfPresent(map, "warnings");
}
