import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Volcano Alerts (Smithsonian GVP / USGS Weekly Report) ─── */

/**
 * Add the volcano-alert layer from the same-origin /api/volcanoes proxy,
 * which serves USGS alert statuses as GeoJSON (the Smithsonian GVP RSS it
 * replaced sits behind a bot-verification challenge no server fetch can
 * pass, and its direct browser fetch was CORS-blocked). Feature `color`/
 * `alert` encode activity level: red/WARNING, orange/WATCH, amber/ADVISORY.
 * Rendered as a coloured 6px circle plus a blurred glow behind it. Reports
 * the feature count ("empty" when nothing is on alert or the upstream is
 * unavailable) and re-fetches every 10 minutes.
 */
export function addVolcanoes(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("volcanoes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/volcanoes");
      const data = (await res.json()) as GeoJSON.FeatureCollection | null;
      const features = res.ok && data?.type === "FeatureCollection" ? data.features : [];

      setStatus(handle, "volcanoes", features.length ? "loaded" : "empty", features.length);

      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

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
    } catch (err) {
      warnLayerError("volcanoes", err);
      setStatus(handle, "volcanoes", "error");
    }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 600000), // 10 min (weekly report)
  );
}

/** Remove the volcano glow and point layers plus the `volcanoes` source, ignoring "not found" errors. */
export function removeVolcanoes(map: maplibregl.Map): void {
  ["volcanoes-glow", "volcanoes-points"].forEach((id) => {
    removeLayerIfPresent(map, id);
  });
  removeSourceIfPresent(map, "volcanoes");
}
