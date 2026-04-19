import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Burn Scars / Active Fires (NASA VIIRS) ─── */

export function addBurnScars(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("burnScars")) return;

  const doLoad = async () => {
    try {
      // NASA FIRMS VIIRS Active Fire data — no API key for basic CSV
      const res = await fetch(
        "https://firms.modaps.eosdis.nasa.gov/api/area/csv/VIIRS_SNPP_NRT/0,-90,360,90/1",
        { signal: AbortSignal.timeout(15000) },
      );
      const text = await res.text();
      const lines = text.trim().split("\n");
      const features: GeoJSON.Feature[] = [];

      for (let i = 1; i < lines.length && features.length < 2000; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 10) continue;
        const lat = parseFloat(cols[0]);
        const lon = parseFloat(cols[1]);
        const confidence = parseFloat(cols[9]);
        const frp = parseFloat(cols[12]);
        if (isNaN(lat) || isNaN(lon)) continue;

        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: { confidence, frp, date: cols[5] },
        });
      }

      setStatus(handle, "burnScars", features.length ? "loaded" : "empty", features.length);

      if (!map.getSource) return;
      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

        if (!map.getSource("burnScars")) {
          map.addSource("burnScars", { type: "geojson", data: geojson });
        } else {
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
                "interpolate", ["linear"], ["get", "confidence"],
                0, "#fbbf24", 30, "#f97316", 60, "#ef4444", 80, "#dc2626",
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
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeBurnScars(map: maplibregl.Map): void {
  ["burnScars-points", "burnScars-glow"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("burnScars"); } catch {}
}
