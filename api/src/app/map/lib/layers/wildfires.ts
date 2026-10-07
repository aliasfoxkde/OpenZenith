import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Wildfires (NASA FIRMS) ─── */

/**
 * Body of /api/wildfires — a GeoJSON FeatureCollection of FIRMS detections
 * whose `features` may be absent when the route returns an error payload.
 */
type WildfiresResponse = { features?: GeoJSON.Feature[] } | null;

/**
 * Add the wildfire layer: FIRMS detections from /api/wildfires rendered as a
 * heatmap (up to zoom 9, weighted by the `confidence` property, black→orange→
 * red ramp) plus a confidence-scaled circle layer that appears at zoom 6+ so
 * individual detections become readable as you zoom in. The fetch re-runs
 * hourly (FIRMS cadence) via an interval on handle.intervals; a non-ok
 * response or a thrown fetch reports "error" on the handle, while an empty or
 * malformed payload leaves the previous data in place.
 */
export function addWildfires(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("wildfires")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/wildfires");
      if (!res.ok) {
        setStatus(handle, "wildfires", "error");
        return;
      }
      const data = (await res.json()) as WildfiresResponse;
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
    } catch (err) {
      warnLayerError("wildfires", err);
      setStatus(handle, "wildfires", "error");
      }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 3600000), // 1 hour
  );
}

/** Remove the wildfire heatmap and circle layers plus the `wildfires` source, ignoring "not found" errors. */
export function removeWildfires(map: maplibregl.Map): void {
  removeLayerIfPresent(map, "wildfires-circles");
  removeLayerIfPresent(map, "wildfires-heat");
  removeSourceIfPresent(map, "wildfires");
}
