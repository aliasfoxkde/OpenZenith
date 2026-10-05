import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── Waterways ─── */

/**
 * Body of /api/waterways — a GeoJSON FeatureCollection whose `features` may be
 * absent when the route returns an error payload.
 */
type WaterwaysResponse = { features?: GeoJSON.Feature[] } | null;

/**
 * Add the waterways layer: OpenStreetMap water features around the current
 * map centre, fetched from /api/waterways with a 50 km radius and rendered
 * as 1.5px sky-blue lines at 0.6 opacity. The query re-runs every 30 seconds
 * against wherever the map is centred, updating the existing GeoJSON source
 * in place; a payload without `features` (including the route's error body)
 * leaves the previous data untouched, and only a thrown fetch reports
 * "error".
 */
export function addWaterways(map: maplibregl.Map, handle: LayerHandle): void {
  // Waterways require a lat/lon center to query. Fetch from current map center.
  if (map.getSource("waterways")) return;

  const doLoad = async () => {
    try {
      const center = map.getCenter();
      const res = await fetch(`/api/waterways?lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}&radius=50`);
      const data = (await res.json()) as WaterwaysResponse;
      if (!data?.features) return;

      try {
        if (!map.getSource("waterways")) {
          map.addSource("waterways", { type: "geojson", data });
        } else {
          map.getSource("waterways")?.setData(data);
        }

        if (!map.getLayer("waterways-line")) {
          map.addLayer({
            id: "waterways-line",
            type: "line",
            source: "waterways",
            paint: {
              "line-color": "#38bdf8",
              "line-width": 1.5,
              "line-opacity": 0.6,
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch (err) {
      warnLayerError("waterways", err);
      setStatus(handle, "waterways", "error");
      }
  };

  void doLoad();
  // Re-fetch on pan (debounced via interval)
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 30000),
  );
}

/** Remove the waterways line layer and the `waterways` source, ignoring "not found" errors. */
export function removeWaterways(map: maplibregl.Map): void {
  try {
    map.removeLayer("waterways-line");
  } catch {}
  try {
    map.removeSource("waterways");
  } catch {}
}
