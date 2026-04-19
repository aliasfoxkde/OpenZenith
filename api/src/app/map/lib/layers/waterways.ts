import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Waterways ─── */

export function addWaterways(map: maplibregl.Map, handle: LayerHandle): void {
  // Waterways require a lat/lon center to query. Fetch from current map center.
  if (map.getSource("waterways")) return;

  const doLoad = async () => {
    try {
      const center = map.getCenter();
      const res = await fetch(`/api/waterways?lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}&radius=50`);
      const data = await res.json();
      if (!map.getSource || !data?.features) return;

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
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  // Re-fetch on pan (debounced via interval)
  handle.intervals.push(setInterval(doLoad, 30000));
}

export function removeWaterways(map: maplibregl.Map): void {
  try {
    map.removeLayer("waterways-line");
  } catch {}
  try {
    map.removeSource("waterways");
  } catch {}
}
