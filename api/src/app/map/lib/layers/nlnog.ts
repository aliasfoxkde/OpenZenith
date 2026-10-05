import type { LayerHandle } from "./types";
import { setStatus, warnLayerError } from "./types";

/* ─── NLNOG Nodes ─── */

/**
 * Node record served by /api/nlnog. `lat`/`lon` are always numbers — the route
 * geocodes upstream entries itself and drops the ones it cannot resolve. The
 * remaining fields mirror the upstream NLNOG API and may be absent.
 */
type NlnogNode = {
  lat: number;
  lon: number;
  id?: number;
  hostname?: string;
  asn?: number;
  city?: string;
  country?: string;
};

/**
 * Body of /api/nlnog: `{nodes, count}` (or `{error}` on upstream failure).
 * The legacy GeoJSON shape is still accepted via the same `features` key.
 */
type NlnogResponse = { nodes?: NlnogNode[]; features?: NlnogNode[]; error?: string } | null;

/**
 * Add the NLNOG measuring-node layer: /api/nlnog is fetched every 10 minutes
 * and its node records (whether delivered as `{nodes}` or legacy GeoJSON
 * `features`) are converted to point features carrying hostname, ASN, city
 * and country. Rendered as 4px orange circles with a thin white stroke on
 * the `nlnog-nodes` source — setData in place on refresh. An empty node list
 * is ignored silently; only a failed fetch reports "error" under
 * "nlnogNodes".
 */
export function addNLNOGNodes(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("nlnog-nodes")) return;

  const doLoad = async () => {
    try {
      const res = await fetch("/api/nlnog");
      const data = (await res.json()) as NlnogResponse;

      // API returns {nodes: [...], count: N}, not GeoJSON — convert
      const nodes = data?.nodes || data?.features || [];
      if (!nodes.length) return;

      const geojson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: nodes.map((n) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [n.lon, n.lat] },
          properties: {
            id: n.id,
            hostname: n.hostname || "",
            asn: n.asn || 0,
            city: n.city || "",
            country: n.country || "",
          },
        })),
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
    } catch (err) {
      warnLayerError("nlnogNodes", err);
      setStatus(handle, "nlnogNodes", "error");
      }
  };

  void doLoad();
  handle.intervals.push(
    setInterval(() => {
      void doLoad();
    }, 600000),
  );
}

/** Remove the NLNOG circle layer and the `nlnog-nodes` source, ignoring "not found" errors. */
export function removeNLNOGNodes(map: maplibregl.Map): void {
  try {
    map.removeLayer("nlnog-circles");
  } catch {}
  try {
    map.removeSource("nlnog-nodes");
  } catch {}
}
