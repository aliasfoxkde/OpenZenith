import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Volcano Alerts (USGS) ─── */

export function addVolcanoes(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("volcanoes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://volcanoes.usgs.gov/feed/v0.1/all.geojson");
      const data = await res.json();
      const feats = data?.features || [];
      setStatus(handle, "volcanoes", feats.length ? "loaded" : "empty", feats.length);

      if (!map.getSource) return;
      try {
        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: feats.map((f: GeoJSON.Feature) => ({
            type: "Feature" as const,
            geometry: f.geometry,
            properties: {
              name: f.properties?.title || "",
              alert: f.properties?.alertLevel || "unknown",
              color: f.properties?.alertLevel === "WARNING" ? "#ff0000"
                : f.properties?.alertLevel === "WATCH" ? "#ff8800"
                : f.properties?.alertLevel === "ADVISORY" ? "#ffcc00"
                : "#888888",
            },
          })),
        };

        if (!map.getSource("volcanoes")) {
          map.addSource("volcanoes", { type: "geojson", data: geojson });
        } else {
          map.getSource("volcanoes")?.setData(geojson);
        }

        if (!map.getLayer("volcanoes-glow")) {
          map.addLayer({
            id: "volcanoes-glow",
            type: "circle",
            source: "volcanoes",
            paint: {
              "circle-radius": 14,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.2,
              "circle-blur": 1,
            },
          });
        }

        if (!map.getLayer("volcanoes-points")) {
          map.addLayer({
            id: "volcanoes-points",
            type: "circle",
            source: "volcanoes",
            paint: {
              "circle-radius": 6,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.9,
              "circle-stroke-width": 2,
              "circle-stroke-color": "#fff",
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      setStatus(handle, "volcanoes", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 300000)); // 5 min
}

export function removeVolcanoes(map: maplibregl.Map): void {
  ["volcanoes-glow", "volcanoes-points"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("volcanoes"); } catch {}
}
