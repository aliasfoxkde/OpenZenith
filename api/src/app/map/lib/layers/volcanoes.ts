import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Volcano Alerts (Smithsonian GVP / USGS Weekly Report) ─── */

export function addVolcanoes(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("volcanoes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://volcano.si.edu/news/WeeklyVolcanoRSS.xml");
      const text = await res.text();

      // Parse RSS XML — extract volcano names and coordinates
      const features: GeoJSON.Feature[] = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match: RegExpExecArray | null;

      while ((match = itemRegex.exec(text)) !== null) {
        const entry = match[1];
        const title = entry.match(/<title>([^<]*)<\/title>/)?.[1] || "";
        const pointMatch = entry.match(/<georss:point>([^<]*)<\/georss:point>/);

        if (pointMatch) {
          const [latStr, lonStr] = pointMatch[1].trim().split(/\s+/);
          const lat = parseFloat(latStr);
          const lon = parseFloat(lonStr);

          if (!isNaN(lat) && !isNaN(lon)) {
            // Determine color from activity type in title
            const isNew = /New Unrest|New Activity/i.test(title);
            const isErupting = /Erupting/i.test(title);
            const color = isErupting ? "#ef4444" : isNew ? "#f97316" : "#fbbf24";

            features.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: { name: title, color, alert: isErupting ? "WARNING" : isNew ? "WATCH" : "ADVISORY" },
            });
          }
        }
      }

      setStatus(handle, "volcanoes", features.length ? "loaded" : "empty", features.length);

      if (!map.getSource) return;
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
    } catch {
      setStatus(handle, "volcanoes", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000)); // 10 min (weekly report)
}

export function removeVolcanoes(map: maplibregl.Map): void {
  ["volcanoes-glow", "volcanoes-points"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("volcanoes");
  } catch {}
}
