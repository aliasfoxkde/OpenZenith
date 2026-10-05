import type { LayerHandle } from "./types";
import { latLonToTile } from "./types";

/* ─── Topo Contours ─── */

/**
 * Body of /api/contours/{z}/{x}/{y} — a GeoJSON FeatureCollection. `features`
 * is optional because the route serves an error body when tile assembly fails.
 */
type ContourTile = { features?: GeoJSON.Feature[] };

/**
 * Add topographic contour lines: on every moveend (debounced 300 ms) the
 * visible tiles at the current integer zoom are enumerated via latLonToTile
 * and fetched from /api/contours/{z}/{x}/{y} in parallel — up to 6 tiles per
 * pass, and skipped entirely below zoom 7 where DEM assembly is unreliable.
 * Features carry a `type` property split across two line layers: thin grey
 * `minor` contours and thicker, brighter `major` ones. Registers moveend/
 * zoomend listeners on the map and clears them through handle.cleanup; no
 * status is reported to the handle.
 */
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
          map.getSource("contours")?.setData({ type: "FeatureCollection", features: [] });
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
              .then((r) => (r.ok ? (r.json() as Promise<ContourTile | null>) : null))
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
        map.getSource("contours")?.setData({ type: "FeatureCollection", features: allFeatures });
      }
    } catch {
      /* skip */
    }
  };

  const onMoveEnd = () => {
    if (loadTimeout) clearTimeout(loadTimeout);
    loadTimeout = setTimeout(() => {
      void loadContours();
    }, 300);
  };

  map.on("moveend", onMoveEnd);
  map.on("zoomend", onMoveEnd);
  void loadContours();

  handle.cleanup = () => {
    map.off("moveend", onMoveEnd);
    map.off("zoomend", onMoveEnd);
    if (loadTimeout) clearTimeout(loadTimeout);
  };
}

/** Remove both contour line layers and the `contours` source, ignoring "not found" errors. */
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
