import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Lightning (Blitzortung.org WebSocket) ─── */

let ws: WebSocket | null = null;
const MAX_STRIKES = 500;
const strikes: GeoJSON.Feature[] = [];

export function addLightning(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("lightning")) return;

  // Add source + layer with empty data
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  if (!map.getSource("lightning")) {
    map.addSource("lightning", { type: "geojson", data: empty });
  }

  if (!map.getLayer("lightning-glow")) {
    map.addLayer({
      id: "lightning-glow",
      type: "circle",
      source: "lightning",
      paint: {
        "circle-radius": 10,
        "circle-color": "rgba(251,191,36,0.25)",
        "circle-blur": 1,
      },
    });
  }

  if (!map.getLayer("lightning-points")) {
    map.addLayer({
      id: "lightning-points",
      type: "circle",
      source: "lightning",
      paint: {
        "circle-radius": 3,
        "circle-color": "#fbbf24",
        "circle-opacity": 0.9,
      },
    });
  }

  // Connect to Blitzortung WebSocket
  const connect = () => {
    try {
      if (ws) ws.close();

      ws = new WebSocket("wss://ws.blitzortung.org:443/");

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.lon !== undefined && msg.lat !== undefined) {
            strikes.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [msg.lon, msg.lat] },
              properties: { time: msg.time || 0 },
            });

            // Keep only recent strikes
            if (strikes.length > MAX_STRIKES) {
              strikes.splice(0, strikes.length - MAX_STRIKES);
            }

            const source = map.getSource("lightning");
            if (source && "setData" in source) {
              source.setData({ type: "FeatureCollection", features: [...strikes] });
            }

            setStatus(handle, "lightning", "loaded", strikes.length);
          }
        } catch {}
      };

      ws.onerror = () => {
        setStatus(handle, "lightning", "error");
      };

      ws.onclose = () => {
        // Reconnect after 30s
        setTimeout(connect, 30000);
      };
    } catch {
      setStatus(handle, "lightning", "error");
    }
  };

  connect();
  handle.cleanup = () => {
    if (ws) {
      ws.close();
      ws = null;
    }
    strikes.length = 0;
  };
}

export function removeLightning(map: maplibregl.Map): void {
  ["lightning-glow", "lightning-points"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("lightning");
  } catch {}
  if (ws) {
    ws.close();
    ws = null;
  }
  strikes.length = 0;
}
