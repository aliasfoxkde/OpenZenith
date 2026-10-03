import type { LayerHandle } from "./types";
import { setStatus, warnLayerError, domEventCause } from "./types";

/* ─── Vessels (AIS via AISstream.io) ─── */

/** Bootstrap payload served by /api/vessels. */
interface VesselsConfig {
  configured?: boolean;
  wsUrl?: string;
  apiKey?: string;
}

/**
 * AISstream.io `PositionReport` message. The feed also emits array-framed
 * batches (`[msg, msg, ...]`), and individual fields are absent on some
 * transponders, so everything is optional.
 */
interface AISPositionReport {
  MessageType?: string;
  MMSI?: number;
  Name?: string;
  ShipType?: string | number;
  Heading?: number;
  Latitude?: number;
  Longitude?: number;
  Speed?: number;
  Cog?: number;
  Destination?: string;
}

/** Pull the report out of an array-framed or single-message AIS payload. */
function asVesselReport(raw: unknown): AISPositionReport | null | undefined {
  // `Array.isArray` narrows `unknown` to `any[]`; pin the element type back to
  // `unknown` so the report stays guarded below.
  const first = Array.isArray(raw) ? (raw as readonly unknown[])[0] : raw;
  return first as AISPositionReport | null | undefined;
}

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
      const config = (await res.json()) as VesselsConfig;

      if (!config.configured || !config.wsUrl || !config.apiKey) {
        setStatus(handle, "vessels", "empty");
        return;
      }

      // Close existing connection
      if (ws) ws.close();

      ws = new WebSocket(config.wsUrl);
      vesselCount = 0;

      // Only set once `ws.onopen` fires — reads before that see undefined.
      let dataTimeout: ReturnType<typeof setTimeout> | undefined;

      ws.onopen = () => {
        // Subscribe to global vessel positions
        ws?.send(
          JSON.stringify({
            APIKey: config.apiKey,
            BoundingBoxes: [
              [
                [-180, -90],
                [180, 90],
              ],
            ],
            FilterMessageTypes: ["PositionReport"],
          }),
        );
        setStatus(handle, "vessels", "loaded", 0);

        // If no data arrives within 15s, mark as empty
        // (AISstream free tier may be non-functional)
        dataTimeout = setTimeout(() => {
          if (vesselCount === 0) {
            setStatus(handle, "vessels", "empty");
          }
        }, 15000);
      };

      ws.onmessage = (evt: MessageEvent<unknown>) => {
        try {
          const report = asVesselReport(JSON.parse(String(evt.data)));

          if (report?.MessageType === "PositionReport") {
            vesselCount++;
            if (vesselCount === 1 && dataTimeout) {
              clearTimeout(dataTimeout); // Cancel empty-timeout once data flows
            }

            // Update source with latest position (accumulate on map)
            const source = map.getSource("vessels");
            if (source) {
              // Accumulate features by merging with existing data
              const features = source._data?.features ?? [];

              // Check if MMSI already exists, update it
              const mmsi = report.MMSI;
              // Structural cast on purpose: `features` mirrors MapLibre's
              // internal source data, whose `properties` may be absent.
              const idx = features.findIndex((f) => (f.properties as { mmsi?: number } | null)?.mmsi === mmsi);
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

      ws.onerror = (ev) => {
        warnLayerError("vessels", domEventCause(ev), "websocket");
        setStatus(handle, "vessels", "error");
      };

      ws.onclose = () => {
        if (dataTimeout) clearTimeout(dataTimeout);
        // Auto-reconnect after 30s (not 10s — reduce load on non-functional service)
        setTimeout(() => {
          if (map.getSource("vessels")) void connect();
        }, 30000);
      };
    } catch (err) {
      warnLayerError("vessels", err);
      setStatus(handle, "vessels", "error");
      }
  };

  void connect();

  handle.cleanup = () => {
    if (ws) {
      ws.close();
      ws = null;
    }
  };
}

export function removeVessels(map: maplibregl.Map): void {
  ["vessels-points", "vessels-glow"].forEach((id) => {
    try {
      map.removeLayer(id);
    } catch {}
  });
  try {
    map.removeSource("vessels");
  } catch {}
  if (ws) {
    ws.close();
    ws = null;
  }
}
