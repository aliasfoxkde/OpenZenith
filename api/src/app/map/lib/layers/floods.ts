import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Flood Extent (Copernicus EMS Rapid Mapping + GLOFAS) ─── */

export function addFloods(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("floods")) return;

  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  try {
    if (!map.getSource("floods")) {
      map.addSource("floods", { type: "geojson", data: empty });
    }
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
    /* layers may already exist */
  }

  const doLoad = async () => {
    try {
      setStatus(handle, "floods", "loading");

      // JRC CDF-Proxy is no longer publicly accessible.
      // Return empty gracefully — layer will show "empty" status.
      setStatus(handle, "floods", "empty", 0);
    } catch {
      setStatus(handle, "floods", "error");
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
