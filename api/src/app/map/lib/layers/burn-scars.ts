import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Active Fires (NASA FIRMS VIIRS via /api/wildfires proxy) ─── */

export function addBurnScars(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("burnScars")) return;

  const doLoad = async () => {
    try {
      // Use the API proxy which has the FIRMS_MAP_KEY
      const res = await fetch("/api/wildfires", {
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      const features = data?.features || [];

      setStatus(handle, "burnScars", features.length ? "loaded" : "empty", features.length);

      if (!map.getSource) return;
      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

        if (!map.getSource("burnScars")) {
          map.addSource("burnScars", { type: "geojson", data: geojson });
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MapLibre untyped API
          (map.getSource("burnScars") as any).setData(geojson);
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
    } catch {
      setStatus(handle, "burnScars", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000)); // 10 min
}

export function removeBurnScars(map: maplibregl.Map): void {
  ["burnScars-points", "burnScars-glow"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("burnScars");
  } catch {}
}
