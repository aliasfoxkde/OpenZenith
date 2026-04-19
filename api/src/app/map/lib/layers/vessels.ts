import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Vessels (AIS via AISstream.io) ─── */

let ws: WebSocket | null = null;
let vesselCount = 0;

export function addVessels(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("vessels")) return;

  // Add empty source + layers
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  try {
    if (!map.getSource("vessels")) {
      map.addSource("vessels", { type: "geojson", data: empty });
    }
    if (!map.getLayer("vessels-glow")) {
      map.addLayer({
        id: "vessels-glow",
        type: "circle",
        source: "vessels",
        paint: {
          "circle-radius": 8,
          "circle-color": "rgba(0, 229, 255, 0.12)",
          "circle-blur": 1,
        },
      });
    }
    if (!map.getLayer("vessels-points")) {
      map.addLayer({
        id: "vessels-points",
        type: "circle",
        source: "vessels",
        paint: {
          "circle-radius": 4,
          "circle-color": "#00e5ff",
          "circle-opacity": 0.8,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(0,229,255,0.3)",
        },
      });
    }
  } catch {
    /* layers may already exist */
  }

  const connect = async () => {
    try {
      setStatus(handle, "vessels", "loading");
      const res = await fetch("/api/vessels");
      const config = await res.json();

      if (!config.configured || !config.wsUrl || !config.apiKey) {
        setStatus(handle, "vessels", "empty");
        return;
      }

      // Close existing connection
      if (ws) ws.close();

      ws = new WebSocket(config.wsUrl);
      vesselCount = 0;

      ws.onopen = () => {
        // Subscribe to global vessel positions
        ws?.send(
          JSON.stringify({
            APIKey: config.apiKey,
            BoundingBoxes: [[[-180, -90], [180, 90]]],
            FilterMessageTypes: ["PositionReport"],
          }),
        );
        setStatus(handle, "vessels", "loaded", 0);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          const report = Array.isArray(msg) ? msg[0] : msg;

          if (report?.MessageType === "PositionReport") {
            vesselCount++;

            // Update source with latest position (accumulate on map)
            const source = map.getSource("vessels") as any;
            if (source && source.setData) {
              // Accumulate features by merging with existing data
              const existing = source._data || { type: "FeatureCollection", features: [] };
              const features = existing.features || [];

              // Check if MMSI already exists, update it
              const mmsi = report.MMSI;
              const idx = features.findIndex((f: GeoJSON.Feature) => f.properties?.mmsi === mmsi);
              const feature: GeoJSON.Feature = {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [report.Longitude ?? 0, report.Latitude ?? 0],
                },
                properties: {
                  mmsi: mmsi,
                  name: report.Name || "",
                  shipType: report.ShipType || "",
                  heading: report.Heading ?? 0,
                  speed: report.Speed ?? 0,
                  cog: report.Cog ?? 0,
                  destination: report.Destination || "",
                },
              };

              if (idx >= 0) {
                features[idx] = feature;
              } else {
                features.push(feature);
              }

              // Cap at 5000 features for performance
              if (features.length > 5000) {
                features.splice(0, features.length - 5000);
              }

              source.setData({ type: "FeatureCollection", features });

              // Update status every 10 vessels
              if (vesselCount % 10 === 0) {
                setStatus(handle, "vessels", "loaded", features.length);
              }
            }
          }
        } catch {
          /* parse error, ignore */
        }
      };

      ws.onerror = () => {
        setStatus(handle, "vessels", "error");
      };

      ws.onclose = () => {
        // Auto-reconnect after 10s
        setTimeout(() => {
          if (map.getSource("vessels")) connect();
        }, 10000);
      };
    } catch {
      setStatus(handle, "vessels", "error");
    }
  };

  connect();

  handle.cleanup = () => {
    if (ws) {
      ws.close();
      ws = null;
    }
  };
}

export function removeVessels(map: maplibregl.Map): void {
  ["vessels-points", "vessels-glow"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("vessels"); } catch {}
  if (ws) {
    ws.close();
    ws = null;
  }
}
