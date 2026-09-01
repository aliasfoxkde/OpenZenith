import type { LayerHandle } from "./types";
import { latLonToTile } from "./types";

/* ─── Topo Contours ─── */

export function addContours(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("contours")) return;

  map.addSource("contours", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  // Minor contours — thin, subtle
  map.addLayer({
    id: "contours-minor",
    type: "line",
    source: "contours",
    paint: {
      "line-color": "rgba(148, 163, 184, 0.3)",
      "line-width": 0.5,
    },
    filter: ["==", ["get", "type"], "minor"],
  });

  // Major contours — thicker, brighter
  map.addLayer({
    id: "contours-major",
    type: "line",
    source: "contours",
    paint: {
      "line-color": "rgba(203, 213, 225, 0.6)",
      "line-width": 1.2,
    },
    filter: ["==", ["get", "type"], "major"],
  });

  // Load contour data — refetches on pan/zoom
  let loadTimeout: ReturnType<typeof setTimeout> | null = null;

  const loadContours = async () => {
    try {
      if (!map.getSource("contours")) return;
      const zoom = Math.floor(map.getZoom());
      if (zoom < 7) {
        // Clear contours at low zoom (DEM assembly unreliable)
        if (map.getSource("contours")) {
          map.getSource("contours")?.setData?.({ type: "FeatureCollection", features: [] });
        }
        return;
      }

      const bounds = map.getBounds();
      const nwLat = bounds.getNorthEast().lat;
      const swLat = bounds.getSouthWest().lat;
      const nwLon = bounds.getSouthWest().lng;
      const seLon = bounds.getNorthEast().lng;

      // Fetch contours for all visible tiles
      const allFeatures: GeoJSON.Feature[] = [];
      const promises: Promise<void>[] = [];

      const nw = latLonToTile(nwLat, nwLon, zoom);
      const se = latLonToTile(swLat, seLon, zoom);

      for (let tx = nw.x; tx <= se.x; tx++) {
        for (let ty = nw.y; ty <= se.y; ty++) {
          const maxTiles = 6;
          const tileCount = (se.x - nw.x + 1) * (se.y - nw.y + 1);
          if (tileCount > maxTiles) continue; // Don't overload at low zoom

          promises.push(
            fetch(`/api/contours/${zoom}/${tx}/${ty}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((data) => {
                if (data?.features?.length) {
                  allFeatures.push(...data.features);
                }
              })
              .catch(() => {}),
          );
        }
      }

      await Promise.allSettled(promises);

      if (map.getSource("contours") && allFeatures.length > 0) {
        map.getSource("contours")?.setData?.({ type: "FeatureCollection", features: allFeatures });
      }
    } catch {
      /* skip */
    }
  };

  const onMoveEnd = () => {
    if (loadTimeout) clearTimeout(loadTimeout);
    loadTimeout = setTimeout(loadContours, 300);
  };

  map.on("moveend", onMoveEnd);
  map.on("zoomend", onMoveEnd);
  loadContours();

  handle.cleanup = () => {
    map.off("moveend", onMoveEnd);
    map.off("zoomend", onMoveEnd);
    if (loadTimeout) clearTimeout(loadTimeout);
  };
}

export function removeContours(map: maplibregl.Map): void {
  try {
    map.removeLayer("contours-major");
  } catch {}
  try {
    map.removeLayer("contours-minor");
  } catch {}
  try {
    map.removeSource("contours");
  } catch {}
}
