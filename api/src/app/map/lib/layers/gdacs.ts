import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── GDACS Disaster Alerts ─── */

export function addGdacs(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("gdacs")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("https://www.gdacs.org/gdacsapi/api/events/geteventlist/ATOM");
      const text = await res.text();

      // Parse ATOM XML — extract geo locations from gdacscountryinfo
      const features: GeoJSON.Feature[] = [];
      const itemRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match: RegExpExecArray | null;

      while ((match = itemRegex.exec(text)) !== null) {
        const entry = match[1];

        const title = entry.match(/<title>([^<]*)<\/title>/)?.[1] || "";
        const severity = entry.match(/<gdacs:severity>([^<]*)<\/gdacs:severity>/)?.[1] || "0";
        const severityNum = parseFloat(severity) || 0;

        // Extract coordinates from various gdacs fields
        const latMatch = entry.match(/<gdacs:lat>([^<]*)<\/gdacs:lat>/);
        const lonMatch = entry.match(/<gdacs:lon>([^<]*)<\/gdacs:lon>/);

        if (latMatch && lonMatch) {
          const lat = parseFloat(latMatch[1]);
          const lon = parseFloat(lonMatch[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            const color = severityNum >= 3 ? "#ef4444" : severityNum >= 2 ? "#f97316" : "#fbbf24";
            features.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [lon, lat] },
              properties: { title, severity: severityNum, color },
            });
          }
        }
      }

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
