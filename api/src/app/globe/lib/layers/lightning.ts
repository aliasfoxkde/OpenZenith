/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DataStatus } from "../types";

const LIGHTNING_ICON = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M13 2L4 14h7l-2 8 9-12h-7l2-8z" fill="#ffff00" opacity="0.9"/></svg>`;

const MAX_ACTIVE_STRIKES = 200;

// Module-level refs so cleanupLightning() can access them on unmount
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const activeStrikeIds = new Set<string>();

export function cleanupLightning() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null; // Prevent reconnect timer from firing during close
    ws.close();
    ws = null;
  }
  activeStrikeIds.clear();
}

export function loadLightning(
  viewer: any,
  Cesium: any,
  updateStatus: (key: string, u: Partial<DataStatus>) => void,
  _removeEntities: (prefix: string) => void,
  intervalsRef: React.MutableRefObject<ReturnType<typeof setInterval>[]>,
  stateLayers: { lightning: boolean },
) {
  updateStatus("lightning", { error: null });

  const addStrike = (lat: number, lon: number) => {
    if (!Cesium || !viewer) return;
    if (activeStrikeIds.size >= MAX_ACTIVE_STRIKES) return;

    const id = `strike-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const flashTime = Date.now();
    activeStrikeIds.add(id);

    viewer.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: {
        pixelSize: 6,
        color: Cesium.Color.fromCssColorString("#ffff00"),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      billboard: {
        image: LIGHTNING_ICON,
        width: 14,
        height: 14,
        scaleByDistance: new Cesium.NearFarScalar(5e5, 1.0, 1e7, 0.3),
        show: true,
      },
      properties: { type: "lightning-strike", timestamp: flashTime },
    });

    // Hide billboard after 5s, remove point after 30s
    const entity = viewer.entities.getById(id);
    setTimeout(() => {
      try {
        if (entity?.billboard) entity.billboard.show = false;
      } catch { /* */ }
    }, 5000);

    // Auto-remove after 30s
    setTimeout(() => {
      activeStrikeIds.delete(id);
      try {
        viewer.entities.removeById(id);
      } catch {
        /* already removed */
      }
    }, 35000);
  };

  const connectWs = () => {
    try {
      ws = new WebSocket("wss://ws.blitzortung.org:443/");

      ws.onmessage = (event) => {
        try {
          const data = event.data;
          if (typeof data === "string") {
            const parts = data.split(";");
            if (parts.length >= 3) {
              const lat = parseFloat(parts[1]);
              const lon = parseFloat(parts[2]);
              if (!isNaN(lat) && !isNaN(lon)) {
                addStrike(lat, lon);
              }
            }
          }
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onerror = () => {
        updateStatus("lightning", { error: "WebSocket connection failed. Lightning data unavailable." });
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(() => {
          if (stateLayers.lightning) connectWs();
        }, 30000);
      };

      updateStatus("lightning", { lastUpdate: Date.now(), count: 0 });
    } catch {
      updateStatus("lightning", { error: "Unable to connect to Blitzortung WebSocket" });
    }
  };

  connectWs();

  // Status update using tracked Set instead of scanning all entities
  intervalsRef.current.push(
    setInterval(() => {
      updateStatus("lightning", { lastUpdate: Date.now(), count: activeStrikeIds.size });
    }, 10000),
  );
}
