import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── NLNOG Nodes ─── */

export function addNLNOGNodes(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("nlnog-nodes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/nlnog");
      const data = await res.json();
      if (!map.getSource) return;

      // API returns {nodes: [...], count: N}, not GeoJSON — convert
      const nodes = data?.nodes || data?.features || [];
      if (!nodes.length) return;

      const geojson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: nodes.map(
          (n: {
            lat: number;
            lon: number;
            id: number;
            hostname?: string;
            asn?: number;
            city?: string;
            country?: string;
          }) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [n.lon, n.lat] },
            properties: {
              id: n.id,
              hostname: n.hostname || "",
              asn: n.asn || 0,
              city: n.city || "",
              country: n.country || "",
            },
          }),
        ),
      };

      try {
        if (!map.getSource("nlnog-nodes")) {
          map.addSource("nlnog-nodes", { type: "geojson", data: geojson });
        } else {
          map.getSource("nlnog-nodes")?.setData(geojson);
        }

        if (!map.getLayer("nlnog-circles")) {
          map.addLayer({
            id: "nlnog-circles",
            type: "circle",
            source: "nlnog-nodes",
            paint: {
              "circle-radius": 4,
              "circle-color": "#f97316",
              "circle-opacity": 0.8,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(255,255,255,0.3)",
            },
          });
        }
      } catch {
        /* style may have changed */
      }
    } catch {
      /* fetch failed */
    }
  };

  doLoad();
  handle.intervals.push(setInterval(doLoad, 600000));
}

export function removeNLNOGNodes(map: maplibregl.Map): void {
  try {
    map.removeLayer("nlnog-circles");
  } catch {}
  try {
    map.removeSource("nlnog-nodes");
  } catch {}
}
