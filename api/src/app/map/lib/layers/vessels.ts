import type { LayerHandle } from "./types";
import { setStatus } from "./types";

/* ─── Vessels (AIS) ─── */

let ws: WebSocket | null = null;

export function addVessels(map: maplibregl.Map, handle: LayerHandle): void {
  if (map.getSource("vessels")) return;

  // Add empty source + layer first
  const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  if (!map.getSource("vessels")) {
    map.addSource("vessels", { type: "geojson", data: empty });
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

  // Fetch config then open WebSocket
  const connect = async () => {
    try {
      const res = await fetch("/api/vessels");
      const config = await res.json();

      if (config.error || !process.env.NEXT_PUBLIC_AISSTREAM_KEY) {
        setStatus(handle, "vessels", "empty");
        return;
      }

      if (ws) ws.close();

      ws = new WebSocket(config.wsUrl);

      ws.onopen = () => {
        // Subscribe to all vessel positions
        ws?.send(
          JSON.stringify({
            ApiKey: process.env.NEXT_PUBLIC_AISSTREAM_KEY,
            BoundingBoxes: [[[-90, -180], [90, 180]]],
          }),
        );
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg[0]?.MessageType === "PositionReport") {
            const p = msg[0];
            const feature: GeoJSON.Feature = {
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.Longitude, p.Latitude] },
              properties: {
                name: p.Name || "",
                mmsi: p.MMSI,
                type: p.ShipType || "",
                heading: p.Heading ?? 0,
                speed: p.Speed ?? 0,
              },
            };
            const source = map.getSource("vessels");
            if (source && "setData" in source) source.setData(feature);
          }
        } catch {}
      };

      ws.onerror = () => {
        setStatus(handle, "vessels", "error");
      };
    } catch {
      setStatus(handle, "vessels", "error");
    }
  };

  connect();
  handle.cleanup = () => {
    if (ws) { ws.close(); ws = null; }
  };
}

export function removeVessels(map: maplibregl.Map): void {
  ["vessels-points"].forEach((id) => {
    try { map.removeLayer(id); } catch {}
  });
  try { map.removeSource("vessels"); } catch {}
  if (ws) { ws.close(); ws = null; }
}
