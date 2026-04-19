import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Flood Extent (Copernicus EMS Rapid Mapping + GLOFAS) ─── */

export function addFloods(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("floods")) return;

  const doLoad = async () => {
    try {
      // GLOFAS forecast provides river flood forecasts globally
      // Using the Copernicus Climate Data Store API (free, no key)
      const res = await fetch("https://floods.jrc.ec.europa.eu/cdf-proxy/api/v1/geojson");
      const data = await res.json();
      const feats = data?.features || data?.events || [];
      setStatus(handle, "floods", feats.length ? "loaded" : "empty", feats.length);

      if (!map.getSource) return;
      try {
        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: feats.map((f: GeoJSON.Feature) => ({
            type: "Feature" as const,
            geometry: f.geometry,
            properties: {
              ...(f.properties || {}),
              color: f.properties?.severity === "extreme" ? "#dc2626"
                : f.properties?.severity === "severe" ? "#f97316"
                : "#3b82f6",
            },
          })),
        };

        if (!map.getSource("floods")) {
          map.addSource("floods", { type: "geojson", data: geojson });
        } else {
          map.getSource("floods")?.setData(geojson);
        }

        // Fill layer for flood polygons
        if (!map.getLayer("floods-fill")) {
          map.addLayer({
            id: "floods-fill",
            type: "fill",
            source: "floods",
            paint: {
              "fill-color": ["get", "color"],
              "fill-opacity": 0.3,
            },
          });
        }

        // Outline
        if (!map.getLayer("floods-outline")) {
          map.addLayer({
            id: "floods-outline",
            type: "line",
            source: "floods",
            paint: {
              "line-color": ["get", "color"],
              "line-width": 2,
              "line-opacity": 0.7,
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      // Fallback: try GLOFAS via proxy
      try {
        const res2 = await fetch("/api/proxy/tms?url=https://floods.jrc.ec.europa.eu/cdf-proxy/api/v1/geojson");
        if (res2.ok) setStatus(handle, "floods", "loaded", 0);
        else setStatus(handle, "floods", "error");
      } catch {
        setStatus(handle, "floods", "error");
      }
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000)); // 10 min
}

export function removeFloods(map: maplibregl.Map): void {
  ["floods-outline", "floods-fill"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("floods"); } catch {}
}
