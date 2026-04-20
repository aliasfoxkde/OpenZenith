import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── GDACS Disaster Alerts ─── */

export function addGdacs(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("gdacs")) return;

  const doLoad = async () => {
    try {
      // GDACS public API discontinued — use RSS feed as fallback
      const res = await fetch("https://www.gdacs.org/rss.aspx");
      const text = await res.text();

      const features: GeoJSON.Feature[] = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match: RegExpExecArray | null;

      while ((match = itemRegex.exec(text)) !== null) {
        const entry = match[1];
        const title = entry.match(/<title>([^<]*)<\/title>/)?.[1] || "";

        // Extract coordinates from geo:lat / geo:long
        const latMatch = entry.match(/<geo:lat>([^<]*)<\/geo:lat>/) ||
                         entry.match(/<asgard:lat>([^<]*)<\/asgard:lat>/);
        const lonMatch = entry.match(/<geo:long>([^<]*)<\/geo:long>/) ||
                         entry.match(/<asgard:lon>([^<]*)<\/asgard:lon>/);

        const lat = parseFloat(latMatch?.[1] || "");
        const lon = parseFloat(lonMatch?.[1] || "");

        if (!isNaN(lat) && !isNaN(lon) && title && !title.includes("RSS information")) {
          const isRed = /alert|emergency|red/i.test(title);
          const isOrange = /warning|watch|orange/i.test(title);
          const color = isRed ? "#ef4444" : isOrange ? "#f97316" : "#fbbf24";
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lon, lat] },
            properties: { title, color },
          });
        }
      }

      // If no features from RSS, return empty gracefully
      setStatus(handle, "gdacs", features.length ? "loaded" : "empty", features.length);

      if (!map.getSource) return;
      try {
        const geojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

        if (!map.getSource("gdacs")) {
          map.addSource("gdacs", { type: "geojson", data: geojson });
        } else {
          map.getSource("gdacs")?.setData(geojson);
        }

        if (!map.getLayer("gdacs-glow")) {
          map.addLayer({
            id: "gdacs-glow",
            type: "circle",
            source: "gdacs",
            paint: {
              "circle-radius": 12,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.2,
              "circle-blur": 1,
            },
          });
        }

        if (!map.getLayer("gdacs-points")) {
          map.addLayer({
            id: "gdacs-points",
            type: "circle",
            source: "gdacs",
            paint: {
              "circle-radius": 5,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.9,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#fff",
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      setStatus(handle, "gdacs", "error");
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000)); // 10 min
}

export function removeGdacs(map: maplibregl.Map): void {
  ["gdacs-glow", "gdacs-points"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("gdacs"); } catch {}
}
