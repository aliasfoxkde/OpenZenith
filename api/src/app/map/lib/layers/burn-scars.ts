import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Active Fires (NASA FIRMS VIIRS via /api/wildfires proxy) ─── */

/** GeoJSON FeatureCollection served by /api/wildfires. */
interface WildfireResponse {
  features?: GeoJSON.Feature[];
}

/**
 * Add the active-fire intensity layer (despite the file name, it renders
 * current FIRMS detections, not burn scars): /api/wildfires is fetched with a
 * 15-second timeout and rendered as two circle layers driven by the `frp`
 * (fire radiative power) property — a wide 4-20px orange glow and a 2-8px
 * core whose colour ramps from amber to deep red across `confidence` 0-80.
 * Reports "loaded"/"empty" with the feature count, refreshes every 10
 * minutes, and reports "error" on timeout or fetch failure.
 */
export function addBurnScars(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("burnScars")) return;

  const doLoad = async () => {
    try {
      // Use the API proxy which has the FIRMS_MAP_KEY
      const res = await fetch("/api/wildfires", {
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json()) as WildfireResponse | null;
      const features = data?.features || [];

      setStatus(handle, "burnScars", features.length ? "loaded" : "empty", features.length);

      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

        if (!map.getSource("burnScars")) {
          map.addSource("burnScars", { type: "geojson", data: geojson });
        } else {
          map.getSource("burnScars")?.setData(geojson);
        }

        if (!map.getLayer("burnScars-glow")) {
          map.addLayer({
            id: "burnScars-glow",
            type: "circle",
            source: "burnScars",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 4, 50, 12, 200, 20],
              "circle-color": "rgba(255, 100, 0, 0.15)",
              "circle-blur": 1,
            },
          });
        }

        if (!map.getLayer("burnScars-points")) {
          map.addLayer({
            id: "burnScars-points",
            type: "circle",
            source: "burnScars",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 2, 50, 5, 200, 8],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "confidence"],
                0,
                "#fbbf24",
                30,
                "#f97316",
                60,
                "#ef4444",
                80,
                "#dc2626",
              ],
              "circle-opacity": 0.8,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(255,255,255,0.15)",
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch (err) {
      warnLayerError("burnScars", err);
      setStatus(handle, "burnScars", "error");
      }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 600000), // 10 min
  );
}

/** Remove the fire point and glow layers plus the `burnScars` source, ignoring "not found" errors. */
export function removeBurnScars(map: maplibregl.Map): void {
  ["burnScars-points", "burnScars-glow"].forEach((id) => {
    removeLayerIfPresent(map, id);
  });
  removeSourceIfPresent(map, "burnScars");
}
