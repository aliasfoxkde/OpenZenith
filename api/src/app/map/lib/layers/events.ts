import type { LayerHandle } from "./types";
import { removeLayerIfPresent, removeSourceIfPresent, setStatus, warnLayerError } from "./types";

/* ─── Natural Events (NASA EONET) ─── */

/** NASA EONET v3 GeoJSON feed — `features` is what this layer renders. */
type EonetFeed = { features?: GeoJSON.Feature[] };

/**
 * Flatten EONET's `categories: [{id, title}]` array onto scalar properties.
 * The colour match keys on the machine id ("severeStorms"), which only exists
 * inside the array, so a raw EONET feature paints every event the amber
 * fallback; `category` carries that id and `categoryLabel` the display title
 * (mirroring the hurricane layer's pair) for identify to show.
 */
function withCategory(feature: GeoJSON.Feature): GeoJSON.Feature {
  // GeoJSON types properties as `any`; the cast restores a known index
  // signature while keeping the runtime-absent case, and the guards below are
  // the real check.
  const props = feature.properties as Record<string, unknown> | null;
  const list: unknown = props?.categories;
  const first = Array.isArray(list) ? (list[0] as { id?: unknown; title?: unknown } | undefined) : undefined;
  const id = first && typeof first === "object" ? first.id : undefined;
  const title = first && typeof first === "object" ? first.title : undefined;
  return {
    ...feature,
    properties: {
      ...props,
      category: typeof id === "string" && id ? id : "Event",
      categoryLabel: typeof title === "string" && title ? title : "Event",
    },
  };
}

/**
 * Add the NASA EONET natural-events layer: open events (limit 200) fetched
 * from eonet.gsfc.nasa.gov as GeoJSON and rendered as a 6px circle layer
 * over a 14px blurred glow, coloured by event category — red for
 * volcanoes/severe storms/icebergs, orange for wildfires/sea-lake ice, blue
 * for floods/landslides, amber for everything else. Reports the feature
 * count on the handle and refreshes every 5 minutes; the glow layer is only
 * created alongside the point layer, and a failed request reports "error".
 */
export function addNaturalEvents(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("natural-events")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200");
      if (!res.ok) {
        setStatus(handle, "events", "error");
        return;
      }
      const data = (await res.json()) as EonetFeed;
      if (!data.features) return;
      const features = data.features.map(withCategory);
      setStatus(handle, "events", "loaded", features.length);

      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
        if (!map.getSource("natural-events")) {
          map.addSource("natural-events", { type: "geojson", data: geojson });
        } else {
          map.getSource("natural-events")?.setData(geojson);
        }

        if (!map.getLayer("natural-events-points")) {
          map.addLayer({
            id: "natural-events-points",
            type: "circle",
            source: "natural-events",
            paint: {
              "circle-radius": 6,
              "circle-color": [
                "match",
                ["coalesce", ["get", "category"], ""],
                ["volcanoes", "severeStorms", "icebergs"],
                "#ef4444",
                ["wildfires", "seaLakeIce"],
                "#f97316",
                ["floods", "landslides"],
                "#3b82f6",
                "#eab308",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(255,255,255,0.6)",
            },
          });

          // Glow underneath
          if (!map.getLayer("natural-events-glow")) {
            map.addLayer({
              id: "natural-events-glow",
              type: "circle",
              source: "natural-events",
              paint: {
                "circle-radius": 14,
                "circle-color": "rgba(239, 68, 68, 0.2)",
                "circle-blur": 1,
              },
            });
          }
        }
      } catch {
        /* style may have changed */
      }
    } catch (err) {
      warnLayerError("events", err);
      setStatus(handle, "events", "error");
    }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 300000), // 5 min
  );
}

/** Remove the EONET glow and point layers plus the `natural-events` source, ignoring "not found" errors. */
export function removeNaturalEvents(map: maplibregl.Map): void {
  removeLayerIfPresent(map, "natural-events-glow");
  removeLayerIfPresent(map, "natural-events-points");
  removeSourceIfPresent(map, "natural-events");
}
